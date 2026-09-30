# ExecRelay

> Run anything. Trace everything. Verify what actually happened.

ExecRelay is a vendor-neutral execution harness for developers and AI agents. It runs, observes, verifies, and records what developers and AI agents actually execute. Combining a real terminal with structured execution capture, repository change tracking, and explicit verification, ExecRelay establishes honest ground truth for engineering workflows.

[Download](https://maikesig.github.io/ExecRelay/download.html) &bull; [Releases](https://github.com/MaikesiG/ExecRelay/releases) &bull; [Issues](https://github.com/MaikesiG/ExecRelay/issues)

---

## What ExecRelay Does

ExecRelay combines four core surfaces into a unified engineering environment:

### Terminal
A real PTY-backed terminal for everyday engineering work. It supports standard shells, interactive tools, split panes, and shell integration without compromising performance or responsiveness.

### Capture
Records structured execution evidence around commands and process outcomes. Process exit codes and runtime metadata establish process truth; raw execution evidence is preserved rather than inferring success from terminal text.

### Changes
Shows repository changes associated with the observed execution window. It observes working tree modifications during command execution without claiming exclusive causal attribution.

### Verify
Runs explicit verification checks and preserves immutable verification history. It supports deterministic criteria evaluations, selective rerun capabilities, and criterion-specific working directories for monorepo setups.

---

## Trust Model

ExecRelay enforces explicit boundaries between what was reported and what actually happened:

- **Process exit status is process truth:** Native process exit codes determine execution success or failure.
- **Agent prose is not execution truth:** Natural language claims from AI models or scripts are treated as unverified claims until backed by process outcomes.
- **Terminal text alone is not authoritative:** Visual terminal output can be misleading or truncated; exit status and structured events are the source of truth.
- **Evidence preservation:** Raw execution evidence is preserved separately from derived presentation layers.
- **Immutable verification:** Verification run snapshots form a tamper-evident, permanent historical record.
- **Shell integration:** Uses a per-session anti-spoofing/session-correlation nonce to correlate commands and boundaries without pretending to be cryptographic authentication.

---

## Local-First

ExecRelay Terminal v0.1 is built local-first:

- **No account required:** Download, install, and run without signing up or connecting to an external cloud service.
- **Independent terminal runtime:** Designed to keep normal terminal operation independent from telemetry features. The terminal survives even when ExecRelay telemetry fails.
- **Local data residency:** Core execution happens locally on your computer. Workspace files, transcripts, and evidence stay within the local application unless you run commands that communicate externally.

---

## Screenshot

> *Note: Application interface screenshot is being prepared and will be available at `docs/assets/execrelay-terminal.png` with the final release packaging.*

---

## Download

ExecRelay Terminal v0.1 currently targets macOS.

- **Public Download Page:** [Download Page](https://maikesig.github.io/ExecRelay/download.html)
- **GitHub Releases:** [Releases](https://github.com/MaikesiG/ExecRelay/releases)

The v0.1.0 release artifact is being prepared. Pre-release testing targets macOS (Apple Silicon arm64). Packaged DMG artifacts and notarization details will be published directly to GitHub Releases upon completion.

---

## Development

ExecRelay is built with a React/TypeScript frontend and a Rust/Tauri v2 native desktop runtime.

### Prerequisites
- Node.js (v20+ recommended) and npm
- Rust (v1.85+) and Cargo
- macOS development tools (Xcode Command Line Tools)

### Install Dependencies
```bash
npm install
```

### Frontend Development
Run the Vite development server for the workbench:
```bash
npm run dev
```

### Tauri Desktop Development
Run the native desktop application in development mode:
```bash
npm run tauri:dev
```

### Type Checking & Linting
Run static type checking and ESLint:
```bash
npm run typecheck
npm run lint
```

### Tests
Run the automated test suite:
```bash
npm test
```

### Production Build
Build web assets and the native desktop bundle:
```bash
npm run build
npm run tauri:build
```

---

## Architecture

High-level runtime boundary:

```text
React / TypeScript
        ↓
Tauri command/event boundary
        ↓
Rust native runtime
        ↓
PTY / process / filesystem / repository
```

- **React owns presentation:** The UI layer renders the terminal, capture streams, repository diffs, and verification cards.
- **Rust owns native runtime boundaries:** The native core manages child process lifecycles, PTY allocation (`portable-pty`), shell integration, repository status queries, and event routing.

---

## Status

ExecRelay Terminal v0.1.0

Current public scope:
- **Terminal:** PTY management, split panes, and shell integration.
- **Capture:** Bounded execution capture, exit code tracking, and transcript preservation.
- **Changes:** Working tree diffs observed during execution windows.
- **Verify:** Deterministic contracts, criteria execution, and immutable run history.

---

## License

No public license is currently distributed with this source. All rights are reserved until official release licensing is published.
