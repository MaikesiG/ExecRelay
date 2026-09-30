/**
 * Keyboard-first navigation and shortcut system types for CapTerm.
 * HARDEN-010: Stable surfaces 1–6 (Capture + Evidence consolidated).
 */

export type AppCommand =
  | 'focus-terminal'
  | 'focus-capture-evidence'
  | 'focus-changes'
  | 'focus-verification'
  | 'focus-agents'
  | 'focus-governance';

export type ShortcutScope = 'global' | 'terminal' | 'monitor' | 'modal';

export type MonitorView =
  | 'capture-evidence'
  | 'changes'
  | 'verification'
  | 'agents'
  | 'governance';

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

export interface KeyboardShortcutSettings {
  version: 1;
  bindings: Partial<Record<AppCommand, ShortcutBinding>>;
}

export interface ShortcutCapabilities {
  agents?: boolean;
  governance?: boolean;
}

export interface AppCommandMetadata {
  id: AppCommand;
  label: string;
  surface: 'terminal' | 'monitor';
  monitorView?: MonitorView;
  positionNumber: number; // 1 for terminal, 2..6 for monitor views
  description: string;
}

export const APP_COMMAND_METADATA: Record<AppCommand, AppCommandMetadata> = {
  'focus-terminal': {
    id: 'focus-terminal',
    label: 'Terminal',
    surface: 'terminal',
    positionNumber: 1,
    description: 'Focus primary terminal surface (last active pane)',
  },
  'focus-capture-evidence': {
    id: 'focus-capture-evidence',
    label: 'Capture',
    surface: 'monitor',
    monitorView: 'capture-evidence',
    positionNumber: 2,
    description: 'Open and focus Capture control and captured Evidence',
  },
  'focus-changes': {
    id: 'focus-changes',
    label: 'Changes',
    surface: 'monitor',
    monitorView: 'changes',
    positionNumber: 3,
    description: 'Open and focus Repository Changes and diff evidence',
  },
  'focus-verification': {
    id: 'focus-verification',
    label: 'Verify',
    surface: 'monitor',
    monitorView: 'verification',
    positionNumber: 4,
    description: 'Open and focus Verification runs and contracts',
  },
  'focus-agents': {
    id: 'focus-agents',
    label: 'Agents',
    surface: 'monitor',
    monitorView: 'agents',
    positionNumber: 5,
    description: 'Open and focus Agent runs and comparisons',
  },
  'focus-governance': {
    id: 'focus-governance',
    label: 'Governance',
    surface: 'monitor',
    monitorView: 'governance',
    positionNumber: 6,
    description: 'Open and focus Policy approvals and governance',
  },
};

export const ORDERED_APP_COMMANDS: AppCommand[] = [
  'focus-terminal',
  'focus-capture-evidence',
  'focus-changes',
  'focus-verification',
  'focus-agents',
  'focus-governance',
];

export const ORDERED_MONITOR_VIEWS: MonitorView[] = [
  'capture-evidence',
  'changes',
  'verification',
  'agents',
  'governance',
];
