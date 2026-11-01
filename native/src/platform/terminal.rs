//! Platform terminal/process primitives backed by `portable-pty`.
//!
//! This module owns PTY handles and process-lifecycle facts. It deliberately does not
//! interpret shell markers, construct ExecRelay executions, or decide product outcomes.

use crate::error::{Result, TerminalError};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

const INTERRUPT_BYTE: u8 = 0x03;
/// Child status poll cadence. Polling (instead of a blocking `wait`) releases the child
/// handle between polls so teardown can use `Child::kill`, which escalates beyond SIGHUP.
const CHILD_POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyStreamState {
    Open,
    Eof,
    ReadFailed(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChildWaitOutcome {
    Exited { exit_code: i32 },
    WaitFailed(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchOutcome {
    Accepted,
    Failed(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InterruptObservation {
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InterruptFacts {
    pub requested: bool,
    pub dispatch: Option<DispatchOutcome>,
    pub observation: InterruptObservation,
}

impl Default for InterruptFacts {
    fn default() -> Self {
        Self {
            requested: false,
            dispatch: None,
            observation: InterruptObservation::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeardownFacts {
    pub requested: bool,
    pub dispatch: Option<DispatchOutcome>,
    pub completed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalLifecycleFacts {
    pub stream: PtyStreamState,
    pub child: Option<ChildWaitOutcome>,
    pub interrupt: InterruptFacts,
    pub teardown: TeardownFacts,
}

impl Default for TerminalLifecycleFacts {
    fn default() -> Self {
        Self {
            stream: PtyStreamState::Open,
            child: None,
            interrupt: InterruptFacts::default(),
            teardown: TeardownFacts {
                requested: false,
                dispatch: None,
                completed: false,
            },
        }
    }
}

struct LifecycleState {
    facts: Mutex<TerminalLifecycleFacts>,
    changed: Condvar,
}

/// Shared fact store used independently by the PTY reader, child waiter, and teardown path.
#[derive(Clone)]
pub struct TerminalLifecycle {
    state: Arc<LifecycleState>,
}

impl TerminalLifecycle {
    fn new() -> Self {
        Self {
            state: Arc::new(LifecycleState {
                facts: Mutex::new(TerminalLifecycleFacts::default()),
                changed: Condvar::new(),
            }),
        }
    }

    #[cfg(test)]
    pub fn snapshot(&self) -> TerminalLifecycleFacts {
        self.state
            .facts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn record_reader_eof(&self) {
        let mut facts = self
            .state
            .facts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        facts.stream = PtyStreamState::Eof;
        self.state.changed.notify_all();
    }

    pub fn record_reader_failure(&self, message: String) {
        let mut facts = self
            .state
            .facts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        facts.stream = PtyStreamState::ReadFailed(message);
        self.state.changed.notify_all();
    }

    fn has_child_outcome(&self) -> bool {
        self.state
            .facts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .child
            .is_some()
    }

    fn record_child_outcome(&self, outcome: ChildWaitOutcome) {
        let mut facts = self
            .state
            .facts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        facts.child = Some(outcome);
        if facts.teardown.requested {
            facts.teardown.completed = true;
        }
        self.state.changed.notify_all();
    }

    fn begin_teardown(&self) -> bool {
        let mut facts = self
            .state
            .facts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if facts.teardown.requested {
            return false;
        }
        facts.teardown.requested = true;
        if facts.child.is_some() {
            facts.teardown.completed = true;
        }
        true
    }

    fn record_teardown_dispatch(&self, outcome: DispatchOutcome) {
        let mut facts = self
            .state
            .facts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        facts.teardown.dispatch = Some(outcome);
        self.state.changed.notify_all();
    }

    fn record_interrupt_request(&self) {
        let mut facts = self
            .state
            .facts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        facts.interrupt.requested = true;
        facts.interrupt.dispatch = None;
    }

    fn record_interrupt_dispatch(&self, outcome: DispatchOutcome) {
        let mut facts = self
            .state
            .facts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        facts.interrupt.dispatch = Some(outcome);
        self.state.changed.notify_all();
    }

    /// Waits for authoritative child evidence, allowing a short bounded interval for
    /// the reader to drain. PTY EOF never creates child-exit evidence.
    pub fn wait_for_exit_event(&self, drain_timeout: Duration) -> TerminalLifecycleFacts {
        let mut facts = self
            .state
            .facts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while facts.child.is_none() {
            facts = self
                .state
                .changed
                .wait(facts)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        // Waits for the stream itself to end: other fact changes (an interrupt or teardown
        // dispatch) and spurious wakeups do not end the drain early.
        let (facts, _) = self
            .state
            .changed
            .wait_timeout_while(facts, drain_timeout, |facts| {
                facts.stream == PtyStreamState::Open
            })
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        facts.clone()
    }
}

/// Owns the PTY reader/writer/master, the child handle, and lifecycle facts.
pub struct TerminalBackend {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    lifecycle: TerminalLifecycle,
}

impl TerminalBackend {
    pub fn spawn(command: CommandBuilder, size: PtySize) -> Result<Self> {
        let pair = native_pty_system()
            .openpty(size)
            .map_err(|error| TerminalError::PtyError(error.to_string()))?;
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| TerminalError::SpawnFailed(error.to_string()))?;
        let child = Arc::new(Mutex::new(child));
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| TerminalError::PtyError(error.to_string()))?;
        let lifecycle = TerminalLifecycle::new();
        let waiter_lifecycle = lifecycle.clone();
        let waiter_child = Arc::clone(&child);

        if let Err(error) = std::thread::Builder::new()
            .name("terminal-child-waiter".to_string())
            .spawn(move || loop {
                let Ok(mut child) = waiter_child.lock() else {
                    waiter_lifecycle.record_child_outcome(ChildWaitOutcome::WaitFailed(
                        "child lock poisoned".into(),
                    ));
                    return;
                };
                // The outcome is recorded while the child lock is held so teardown never
                // signals a PID that has already been reaped.
                let outcome = match child.try_wait() {
                    Ok(Some(status)) => ChildWaitOutcome::Exited {
                        exit_code: status.exit_code() as i32,
                    },
                    Ok(None) => {
                        drop(child);
                        std::thread::sleep(CHILD_POLL_INTERVAL);
                        continue;
                    }
                    Err(error) => ChildWaitOutcome::WaitFailed(error.to_string()),
                };
                waiter_lifecycle.record_child_outcome(outcome);
                return;
            })
        {
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
            return Err(TerminalError::SpawnFailed(format!("child waiter: {error}")));
        }

        Ok(Self {
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            child,
            lifecycle,
        })
    }

    pub fn lifecycle(&self) -> TerminalLifecycle {
        self.lifecycle.clone()
    }

    pub fn write(&self, data: &[u8]) -> Result<()> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|error| TerminalError::LockPoisoned(format!("writer lock: {error}")))?;
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    pub fn dispatch_interrupt(&self) -> Result<DispatchOutcome> {
        self.lifecycle.record_interrupt_request();
        match self.write(&[INTERRUPT_BYTE]) {
            Ok(()) => {
                let outcome = DispatchOutcome::Accepted;
                self.lifecycle.record_interrupt_dispatch(outcome.clone());
                Ok(outcome)
            }
            Err(error) => {
                let outcome = DispatchOutcome::Failed(error.to_string());
                self.lifecycle.record_interrupt_dispatch(outcome);
                Err(error)
            }
        }
    }

    pub fn resize(&self, size: PtySize) -> Result<()> {
        let master = self
            .master
            .lock()
            .map_err(|error| TerminalError::LockPoisoned(format!("master lock: {error}")))?;
        master
            .resize(size)
            .map_err(|error| TerminalError::PtyError(error.to_string()))
    }

    pub fn try_clone_reader(&self) -> Result<Box<dyn Read + Send>> {
        let master = self
            .master
            .lock()
            .map_err(|error| TerminalError::LockPoisoned(format!("master lock: {error}")))?;
        master
            .try_clone_reader()
            .map_err(|error| TerminalError::PtyError(error.to_string()))
    }

    /// Requests runtime teardown once. Completion is recorded only after the child waiter
    /// observes process completion; a successful kill dispatch is not that observation.
    ///
    /// Dispatch uses `portable-pty`'s `Child::kill`, unchanged from pre-CROSSPLAT-002 close:
    /// on Unix SIGHUP, a bounded grace period, then SIGKILL if the child is still running;
    /// on Windows `TerminateProcess(child, 1)`. Dropping the backend closes the ConPTY,
    /// which ends the Windows output stream and the console's remaining attached clients.
    pub fn request_teardown(&self) {
        if !self.lifecycle.begin_teardown() {
            return;
        }
        let outcome = match self.child.lock() {
            Ok(_) if self.lifecycle.has_child_outcome() => return,
            Ok(mut child) => match child.kill() {
                Ok(()) => DispatchOutcome::Accepted,
                Err(error) => DispatchOutcome::Failed(error.to_string()),
            },
            Err(error) => DispatchOutcome::Failed(format!("child lock: {error}")),
        };
        self.lifecycle.record_teardown_dispatch(outcome);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reader_eof_is_not_child_exit() {
        let lifecycle = TerminalLifecycle::new();
        lifecycle.record_reader_eof();

        let facts = lifecycle.snapshot();
        assert_eq!(facts.stream, PtyStreamState::Eof);
        assert_eq!(facts.child, None);
    }

    #[test]
    fn child_exit_and_status_are_independent_from_stream_state() {
        let lifecycle = TerminalLifecycle::new();
        lifecycle.record_child_outcome(ChildWaitOutcome::Exited { exit_code: 7 });

        let facts = lifecycle.snapshot();
        assert_eq!(facts.stream, PtyStreamState::Open);
        assert_eq!(facts.child, Some(ChildWaitOutcome::Exited { exit_code: 7 }));
    }

    #[test]
    fn wait_failure_preserves_unknown_exit_status() {
        let lifecycle = TerminalLifecycle::new();
        lifecycle.record_child_outcome(ChildWaitOutcome::WaitFailed("wait failed".into()));

        assert_eq!(
            lifecycle.snapshot().child,
            Some(ChildWaitOutcome::WaitFailed("wait failed".into()))
        );
    }

    #[test]
    fn interrupt_dispatch_does_not_imply_observation() {
        let lifecycle = TerminalLifecycle::new();
        lifecycle.record_interrupt_request();
        lifecycle.record_interrupt_dispatch(DispatchOutcome::Accepted);

        let facts = lifecycle.snapshot();
        assert!(facts.interrupt.requested);
        assert_eq!(facts.interrupt.dispatch, Some(DispatchOutcome::Accepted));
        assert_eq!(facts.interrupt.observation, InterruptObservation::Unknown);
        assert_eq!(facts.child, None);
    }

    #[test]
    fn teardown_is_idempotent_and_completion_requires_child_outcome() {
        let lifecycle = TerminalLifecycle::new();
        assert!(lifecycle.begin_teardown());
        assert!(!lifecycle.begin_teardown());
        lifecycle.record_teardown_dispatch(DispatchOutcome::Accepted);
        assert!(!lifecycle.snapshot().teardown.completed);

        lifecycle.record_child_outcome(ChildWaitOutcome::Exited { exit_code: 0 });
        assert!(lifecycle.snapshot().teardown.completed);
    }

    /// CROSSPLAT-005: after the child exits, the exit event waits for the reader to drain
    /// (bounded). An unrelated fact change in that interval, such as an interrupt dispatched
    /// right after the exit, must not end the drain early.
    #[test]
    fn exit_drain_waits_for_stream_end_despite_unrelated_fact_changes() {
        let lifecycle = TerminalLifecycle::new();
        lifecycle.record_child_outcome(ChildWaitOutcome::Exited { exit_code: 0 });
        let writer = lifecycle.clone();
        let other = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            writer.record_interrupt_dispatch(DispatchOutcome::Accepted);
            std::thread::sleep(Duration::from_millis(150));
            writer.record_reader_eof();
        });

        let facts = lifecycle.wait_for_exit_event(Duration::from_secs(5));
        other.join().unwrap();
        assert_eq!(facts.stream, PtyStreamState::Eof);
        assert_eq!(facts.child, Some(ChildWaitOutcome::Exited { exit_code: 0 }));
    }

    /// The drain stays bounded: a stream that never ends does not hold back child evidence.
    #[test]
    fn exit_drain_is_bounded_when_the_stream_stays_open() {
        let lifecycle = TerminalLifecycle::new();
        lifecycle.record_child_outcome(ChildWaitOutcome::Exited { exit_code: 3 });
        let started = std::time::Instant::now();

        let facts = lifecycle.wait_for_exit_event(Duration::from_millis(100));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(facts.stream, PtyStreamState::Open);
        assert_eq!(facts.child, Some(ChildWaitOutcome::Exited { exit_code: 3 }));
    }

    #[test]
    fn teardown_after_child_exit_is_already_complete() {
        let lifecycle = TerminalLifecycle::new();
        lifecycle.record_child_outcome(ChildWaitOutcome::Exited { exit_code: 0 });

        assert!(lifecycle.begin_teardown());
        assert!(lifecycle.snapshot().teardown.completed);
    }
}
