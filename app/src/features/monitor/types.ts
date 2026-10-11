/**
 * Shared Monitor Surface & Feedback Models
 * HARDEN-010: Action feedback belongs to Monitor; view state belongs to View.
 */

export type MonitorFeedbackLevel = 'info' | 'success' | 'warning' | 'error';

export type MonitorFeedbackSource =
  | 'capture'
  | 'evidence'
  | 'repository'
  | 'verification'
  | 'clipboard'
  | 'system';

export interface MonitorFeedback {
  id: string;
  level: MonitorFeedbackLevel;
  source: MonitorFeedbackSource;
  title: string;
  message?: string;
  dedupeKey?: string;
  createdAt: number;
  dismissible?: boolean;
  durationMs?: number;
}

export interface MonitorFeedbackInput {
  level: MonitorFeedbackLevel;
  source: MonitorFeedbackSource;
  title: string;
  message?: string;
  dedupeKey?: string;
  dismissible?: boolean;
  durationMs?: number;
}

export type { MonitorView, ActiveWorkspaceSurface } from '../shortcuts/types';
