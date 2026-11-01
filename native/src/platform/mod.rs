//! Narrow native platform boundaries.

#[cfg(any(target_os = "linux", target_os = "windows", test))]
pub mod desktop;
pub mod terminal;
