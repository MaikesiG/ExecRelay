/**
 * Centralized Shortcut Reservation and Validation Logic
 * HARDEN-009
 */

import type {
  AppCommand,
  ShortcutBinding,
  ShortcutValidationResult,
} from './types';
import {
  APP_COMMAND_METADATA,
  ORDERED_APP_COMMANDS,
} from './types';
import {
  isMacPlatform,
  normalizeKey,
  areBindingsEqual,
  formatShortcutDisplay,
} from './shortcutNormalization';

// Standard terminal control keys that must never be stolen (Readline / ZLE / POSIX)
const TERMINAL_RESERVED_CTRL_KEYS = new Set([
  'c', // SIGINT interrupt
  'd', // EOF / exit
  'z', // SIGTSTP suspend
  'l', // clear screen
  'r', // reverse search
  'a', // move to line start
  'e', // move to line end
  'k', // kill to line end
  'u', // kill to line start
  'w', // kill word backward
  'p', // previous line / history
  'n', // next line / history
  't', // transpose
  'y', // yank
  'o', // operate-and-get-next
]);

// Standard text editing shortcuts (cut, copy, paste, select all, undo, redo)
const TEXT_EDIT_KEYS = new Set(['c', 'v', 'x', 'a', 'z', 'y']);

// OS / application reserved keys on macOS
const MAC_OS_RESERVED_KEYS = new Set(['q', 'h', 'm', 'w', 'tab', 'space', ',']);

export interface ShortcutValidationContext {
  isMac?: boolean;
  targetCommand?: AppCommand;
  existingBindings?: Partial<Record<AppCommand, ShortcutBinding>>;
}

/**
 * Validates a candidate shortcut binding against all safety policies:
 * 1. Bare keys and Shift-only keys are strictly forbidden.
 * 2. Terminal control keys (Ctrl+C, Ctrl+D, etc.) are protected.
 * 3. Standard text editing keys (Cmd/Ctrl+C, V, X, A, Z) are protected.
 * 4. OS and app-level reserved shortcuts are protected.
 * 5. Escape and safety cancellation keys are protected.
 * 6. Duplicate assignments to other commands are detected.
 */
export function validateShortcutBinding(
  binding: ShortcutBinding,
  context: ShortcutValidationContext = {},
): ShortcutValidationResult {
  const isMac = context.isMac ?? isMacPlatform();
  const key = normalizeKey(binding.key);

  if (!key) {
    return {
      allowed: false,
      reason: 'bare-key',
      message: 'A valid key must be specified.',
    };
  }

  // 1. Escape key safety: Escape cannot be used as a navigation shortcut
  if (key === 'escape') {
    return {
      allowed: false,
      reason: 'app-safety',
      message: 'Escape is reserved for safety and modal cancellation.',
    };
  }

  const hasMeta = Boolean(binding.meta);
  const hasCtrl = Boolean(binding.ctrl);
  const hasAlt = Boolean(binding.alt);
  const hasShift = Boolean(binding.shift);

  // 2. Bare key / Invalid modifier check:
  // Must have a meaningful non-shift modifier. Shift alone is forbidden!
  const hasMeaningfulModifier = isMac
    ? hasMeta || hasCtrl || hasAlt
    : hasCtrl || hasAlt || hasMeta;

  if (!hasMeaningfulModifier) {
    if (hasShift) {
      return {
        allowed: false,
        reason: 'invalid-modifier',
        message: 'Shift alone is not a valid global modifier. Use Command, Ctrl, or Alt.',
      };
    }
    return {
      allowed: false,
      reason: 'bare-key',
      message: 'Global shortcuts require a modifier (Command, Ctrl, or Alt) to protect terminal typing.',
    };
  }

  // 3. Terminal-reserved shortcuts: Ctrl + [c, d, z, l, r, a, e, k, u, w, p, n]
  // On all platforms, plain Ctrl+key must NOT be stolen from the shell
  if (hasCtrl && !hasMeta && !hasAlt && TERMINAL_RESERVED_CTRL_KEYS.has(key)) {
    return {
      allowed: false,
      reason: 'terminal-input',
      message: `Ctrl+${key.toUpperCase()} is reserved for terminal control behavior.`,
    };
  }

  // 4. Text editing shortcuts:
  // macOS: Cmd + [C, V, X, A, Z]
  // Windows/Linux: Ctrl + [C, V, X, A, Z, Y]
  if (isMac && hasMeta && !hasCtrl && !hasAlt && TEXT_EDIT_KEYS.has(key)) {
    return {
      allowed: false,
      reason: 'text-editing',
      message: `${formatShortcutDisplay(binding, isMac)} is reserved for standard text editing.`,
    };
  }
  if (!isMac && hasCtrl && !hasMeta && !hasAlt && TEXT_EDIT_KEYS.has(key)) {
    return {
      allowed: false,
      reason: 'text-editing',
      message: `${formatShortcutDisplay(binding, isMac)} is reserved for standard text editing.`,
    };
  }

  // 5. OS / App-reserved shortcuts:
  // macOS: Cmd + [Q, H, M, W, Tab, Space, ,]
  if (isMac && hasMeta && !hasCtrl && !hasAlt && !hasShift && MAC_OS_RESERVED_KEYS.has(key)) {
    return {
      allowed: false,
      reason: 'os-reserved',
      message: `${formatShortcutDisplay(binding, isMac)} is reserved by the operating system.`,
    };
  }

  // 6. Duplicate conflict check:
  // Does another AppCommand already use this exact shortcut?
  if (context.existingBindings) {
    for (const cmd of ORDERED_APP_COMMANDS) {
      if (context.targetCommand && cmd === context.targetCommand) {
        continue;
      }
      const existing = context.existingBindings[cmd];
      if (existing && areBindingsEqual(existing, binding)) {
        const metadata = APP_COMMAND_METADATA[cmd];
        return {
          allowed: false,
          reason: 'duplicate-binding',
          conflictingCommand: cmd,
          message: `Shortcut already assigned to ${metadata?.label ?? cmd}.`,
        };
      }
    }
  }

  return { allowed: true };
}
