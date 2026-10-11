/**
 * Keyboard-first navigation and shortcut system types for ExecRelay.
 * SHORTCUT-002: Cross-Platform Configurable Shortcuts (Navigation + Terminal Panes).
 */

export type ShortcutPlatform = 'macos' | 'windows' | 'linux';

export type NavigationCommand =
  | 'focus-terminal'
  | 'focus-capture-evidence'
  | 'focus-changes'
  | 'focus-verification'
  | 'workspace.previousTab'
  | 'workspace.nextTab'
  | 'terminal.previousTab'
  | 'terminal.nextTab';

export type TerminalPaneCommand =
  | 'terminal.split-right'
  | 'terminal.split-down'
  | 'terminal.close-pane'
  | 'terminal.focus-left'
  | 'terminal.focus-right'
  | 'terminal.focus-up'
  | 'terminal.focus-down';

export type AppCommand = NavigationCommand | TerminalPaneCommand;

export type ShortcutScope = 'global' | 'terminal' | 'monitor' | 'modal';

export type CommandCategory = 'navigation' | 'terminal';

export type MonitorView =
  | 'capture-evidence'
  | 'changes'
  | 'verification';

export type ActiveWorkspaceSurface =
  | { kind: 'terminal'; paneId?: string }
  | { kind: 'monitor'; view: MonitorView };

export interface ShortcutBinding {
  key: string; // e.g. '1', '2', 'arrowleft', 'd' (normalized)
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export interface NormalizedShortcut {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export type ShortcutReservationReason =
  | 'bare-key'
  | 'terminal-input'
  | 'text-editing'
  | 'os-reserved'
  | 'app-safety'
  | 'invalid-modifier'
  | 'duplicate-binding';

export interface ShortcutValidationResult {
  allowed: boolean;
  reason?: ShortcutReservationReason;
  message?: string;
  conflictingCommand?: AppCommand;
}

export interface KeyboardShortcutSettingsV1 {
  version: 1;
  bindings: Partial<Record<string, ShortcutBinding>>;
}

export interface KeyboardShortcutSettingsV2 {
  version: 2;
  overrides: {
    macos?: Partial<Record<AppCommand, ShortcutBinding>>;
    windows?: Partial<Record<AppCommand, ShortcutBinding>>;
    linux?: Partial<Record<AppCommand, ShortcutBinding>>;
  };
  bindings?: Partial<Record<string, ShortcutBinding>>;
}

export type KeyboardShortcutSettings = KeyboardShortcutSettingsV2;

export interface ShortcutCapabilities {
  terminal?: boolean;
  capture?: boolean;
  changes?: boolean;
  verification?: boolean;
}

export interface AppCommandMetadata {
  id: AppCommand;
  label: string;
  category: CommandCategory;
  surface?: 'terminal' | 'monitor';
  monitorView?: MonitorView;
  positionNumber?: number; // 1 for terminal, 2..4 for monitor views
  description: string;
}

export const APP_COMMAND_METADATA: Record<AppCommand, AppCommandMetadata> = {
  'focus-terminal': {
    id: 'focus-terminal',
    label: 'Terminal',
    category: 'navigation',
    surface: 'terminal',
    positionNumber: 1,
    description: 'Focus primary terminal surface (last active pane)',
  },
  'focus-capture-evidence': {
    id: 'focus-capture-evidence',
    label: 'Capture',
    category: 'navigation',
    surface: 'monitor',
    monitorView: 'capture-evidence',
    positionNumber: 2,
    description: 'Open and focus Capture control and captured Evidence',
  },
  'focus-changes': {
    id: 'focus-changes',
    label: 'Changes',
    category: 'navigation',
    surface: 'monitor',
    monitorView: 'changes',
    positionNumber: 3,
    description: 'Open and focus Repository Changes and diff evidence',
  },
  'focus-verification': {
    id: 'focus-verification',
    label: 'Verify',
    category: 'navigation',
    surface: 'monitor',
    monitorView: 'verification',
    positionNumber: 4,
    description: 'Open and focus Verification runs and contracts',
  },
  'workspace.previousTab': {
    id: 'workspace.previousTab',
    label: 'Workspace: Previous Tab',
    category: 'navigation',
    description: 'Switch to the previous top-level workspace tab',
  },
  'workspace.nextTab': {
    id: 'workspace.nextTab',
    label: 'Workspace: Next Tab',
    category: 'navigation',
    description: 'Switch to the next top-level workspace tab',
  },
  'terminal.previousTab': {
    id: 'terminal.previousTab',
    label: 'Terminal: Previous Tab',
    category: 'navigation',
    surface: 'terminal',
    description: 'Switch to the previous terminal tab in the active workspace',
  },
  'terminal.nextTab': {
    id: 'terminal.nextTab',
    label: 'Terminal: Next Tab',
    category: 'navigation',
    surface: 'terminal',
    description: 'Switch to the next terminal tab in the active workspace',
  },
  'terminal.split-right': {
    id: 'terminal.split-right',
    label: 'Split Right',
    category: 'terminal',
    surface: 'terminal',
    description: 'Split active terminal pane vertically (side-by-side)',
  },
  'terminal.split-down': {
    id: 'terminal.split-down',
    label: 'Split Down',
    category: 'terminal',
    surface: 'terminal',
    description: 'Split active terminal pane horizontally (stacked)',
  },
  'terminal.close-pane': {
    id: 'terminal.close-pane',
    label: 'Close Active Pane',
    category: 'terminal',
    surface: 'terminal',
    description: 'Close the currently active terminal pane in tab',
  },
  'terminal.focus-left': {
    id: 'terminal.focus-left',
    label: 'Terminal Pane: Focus Left',
    category: 'terminal',
    surface: 'terminal',
    description: 'Focus adjacent terminal pane to the left',
  },
  'terminal.focus-right': {
    id: 'terminal.focus-right',
    label: 'Terminal Pane: Focus Right',
    category: 'terminal',
    surface: 'terminal',
    description: 'Focus adjacent terminal pane to the right',
  },
  'terminal.focus-up': {
    id: 'terminal.focus-up',
    label: 'Terminal Pane: Focus Up',
    category: 'terminal',
    surface: 'terminal',
    description: 'Focus adjacent terminal pane above',
  },
  'terminal.focus-down': {
    id: 'terminal.focus-down',
    label: 'Terminal Pane: Focus Down',
    category: 'terminal',
    surface: 'terminal',
    description: 'Focus adjacent terminal pane below',
  },
};

export const ORDERED_NAVIGATION_COMMANDS: NavigationCommand[] = [
  'workspace.previousTab',
  'workspace.nextTab',
  'terminal.previousTab',
  'terminal.nextTab',
  'focus-terminal',
  'focus-capture-evidence',
  'focus-changes',
  'focus-verification',
];

export const ORDERED_TERMINAL_COMMANDS: TerminalPaneCommand[] = [
  'terminal.split-right',
  'terminal.split-down',
  'terminal.close-pane',
  'terminal.focus-left',
  'terminal.focus-right',
  'terminal.focus-up',
  'terminal.focus-down',
];

export const ORDERED_APP_COMMANDS: NavigationCommand[] = [
  'focus-terminal',
  'focus-capture-evidence',
  'focus-changes',
  'focus-verification',
];

export const ALL_CONFIGURABLE_COMMANDS: AppCommand[] = [
  ...ORDERED_NAVIGATION_COMMANDS,
  ...ORDERED_TERMINAL_COMMANDS,
];

export function isNavigationCommand(command: AppCommand): command is NavigationCommand {
  return (
    command === 'focus-terminal' ||
    command === 'focus-capture-evidence' ||
    command === 'focus-changes' ||
    command === 'focus-verification' ||
    command === 'workspace.previousTab' ||
    command === 'workspace.nextTab' ||
    command === 'terminal.previousTab' ||
    command === 'terminal.nextTab'
  );
}

export function isTerminalCommand(command: AppCommand): command is TerminalPaneCommand {
  return (
    command === 'terminal.split-right' ||
    command === 'terminal.split-down' ||
    command === 'terminal.close-pane' ||
    command === 'terminal.focus-left' ||
    command === 'terminal.focus-right' ||
    command === 'terminal.focus-up' ||
    command === 'terminal.focus-down'
  );
}

export const ORDERED_MONITOR_VIEWS: MonitorView[] = [
  'capture-evidence',
  'changes',
  'verification',
];
