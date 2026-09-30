/**
 * Shared Monitor Feedback Controller
 * HARDEN-010
 *
 * Implements the core feedback ownership rule:
 * Action feedback belongs to Monitor; view state belongs to View.
 */

import type {
  MonitorFeedback,
  MonitorFeedbackInput,
  MonitorFeedbackLevel,
  MonitorFeedbackSource,
} from './types';

export const MAX_VISIBLE_MONITOR_FEEDBACK = 3;

export const DEFAULT_FEEDBACK_DURATIONS: Record<MonitorFeedbackLevel, number> = {
  success: 4000,
  info: 4000,
  warning: 8000,
  error: 0, // Manual dismissal preferred for errors
};

export class MonitorFeedbackStore {
  private items: MonitorFeedback[] = [];
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private listeners: Set<() => void> = new Set();

  /**
   * Pushes a new operational feedback item to the Monitor feedback region.
   * Enforces max 3 visible entries and auto-dismiss timers.
   */
  public push(input: MonitorFeedbackInput): string {
    const now = Date.now();
    const durationMs =
      input.durationMs !== undefined
        ? input.durationMs
        : DEFAULT_FEEDBACK_DURATIONS[input.level];

    // Deduplication check: if identical feedback arrived in the last 2500ms, update it
    const existingIdx = this.items.findIndex(
      (item) =>
        item.source === input.source &&
        item.level === input.level &&
        item.title === input.title &&
        now - item.createdAt < 2500,
    );

    if (existingIdx !== -1) {
      const existing = this.items[existingIdx];
      const updated: MonitorFeedback = {
        ...existing,
        message: input.message ?? existing.message,
        createdAt: now,
      };

      this.clearTimer(existing.id);
      this.items[existingIdx] = updated;

      if (durationMs > 0) {
        this.scheduleDismiss(existing.id, durationMs);
      }

      this.notify();
      return existing.id;
    }

    const id = `mfb-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const newItem: MonitorFeedback = {
      id,
      level: input.level,
      source: input.source,
      title: input.title,
      message: input.message,
      createdAt: now,
      dismissible: input.dismissible !== false,
      durationMs,
    };

    // Maintain max visible queue size (drop oldest item if over limit)
    const nextItems = [...this.items, newItem];
    if (nextItems.length > MAX_VISIBLE_MONITOR_FEEDBACK) {
      const removed = nextItems.shift();
      if (removed) {
        this.clearTimer(removed.id);
      }
    }

    this.items = nextItems;

    if (durationMs > 0) {
      this.scheduleDismiss(id, durationMs);
    }

    this.notify();
    return id;
  }

  /**
   * Dismisses a specific feedback item by ID.
   */
  public dismiss(id: string): void {
    const idx = this.items.findIndex((item) => item.id === id);
    if (idx !== -1) {
      this.clearTimer(id);
      this.items = this.items.filter((item) => item.id !== id);
      this.notify();
    }
  }

  /**
   * Clears feedback items, optionally filtered by source domain.
   */
  public clear(source?: MonitorFeedbackSource): void {
    if (source) {
      const remaining: MonitorFeedback[] = [];
      for (const item of this.items) {
        if (item.source === source) {
          this.clearTimer(item.id);
        } else {
          remaining.push(item);
        }
      }
      this.items = remaining;
    } else {
      for (const item of this.items) {
        this.clearTimer(item.id);
      }
      this.items = [];
    }
    this.notify();
  }

  /**
   * Returns a snapshot of current visible feedback items.
   */
  public getItems(): MonitorFeedback[] {
    return [...this.items];
  }

  /**
   * Subscribes a listener to store mutations.
   */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Disposes all active timers.
   */
  public destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.listeners.clear();
  }

  private scheduleDismiss(id: string, delayMs: number): void {
    this.clearTimer(id);
    const timer = setTimeout(() => {
      this.dismiss(id);
    }, delayMs);
    this.timers.set(id, timer);
  }

  private clearTimer(id: string): void {
    const existing = this.timers.get(id);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(id);
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Ignore listener error
      }
    }
  }
}

export function createMonitorFeedbackStore(): MonitorFeedbackStore {
  return new MonitorFeedbackStore();
}
