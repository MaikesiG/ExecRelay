/**
 * Centralized Shortcut Registry & Resolver
 * HARDEN-009
 */

import type {
  AppCommand,
  KeyboardShortcutSettings,
  NormalizedShortcut,
  ShortcutBinding,
  ShortcutCapabilities,
  ShortcutValidationResult,
} from './types';
import { ORDERED_APP_COMMANDS } from './types';
import { getDefaultShortcuts } from './defaultShortcuts';
import {
  isMacPlatform,
  normalizeKeyboardEvent,
  matchesBinding,
  areBindingsEqual,
} from './shortcutNormalization';
import { validateShortcutBinding } from './reservedShortcuts';
import {
  loadShortcutSettings,
  saveShortcutSettings,
  clearShortcutSettings,
} from './shortcutPersistence';

export class ShortcutRegistry {
  private isMac: boolean;
  private overrides: Partial<Record<AppCommand, ShortcutBinding>>;
  private listeners: Set<() => void>;
  private capabilities?: ShortcutCapabilities;

  constructor(
    isMac: boolean = isMacPlatform(),
    initialSettings?: KeyboardShortcutSettings,
    capabilities?: ShortcutCapabilities,
  ) {
    this.isMac = isMac;
    this.overrides = initialSettings ? { ...initialSettings.bindings } : {};
    this.listeners = new Set();
    this.capabilities = capabilities;

    // If initialSettings not provided, attempt to load from persistence
    if (!initialSettings) {
      const persisted = loadShortcutSettings();
      this.overrides = { ...persisted.bindings };
    }
  }

  public getIsMac(): boolean {
    return this.isMac;
  }

  public getCapabilities(): ShortcutCapabilities | undefined {
    return this.capabilities;
  }

  public setCapabilities(capabilities?: ShortcutCapabilities): void {
    this.capabilities = capabilities;
    this.notify();
  }

  public isCommandEnabled(command: AppCommand): boolean {
    if (!this.capabilities) return true;
    if (command === 'focus-agents' && this.capabilities.agents === false) return false;
    if (command === 'focus-governance' && this.capabilities.governance === false) return false;
    return true;
  }

  /**
   * Computes the effective bindings for all commands:
   * Defaults + User Overrides = Effective Bindings.
   * Guarantees that at most one command maps to any specific shortcut.
   */
  public getEffectiveBindings(): Record<AppCommand, ShortcutBinding> {
    const defaults = getDefaultShortcuts(this.isMac);
    const effective: Partial<Record<AppCommand, ShortcutBinding>> = {};

    // Apply explicit overrides for enabled commands
    for (const cmd of ORDERED_APP_COMMANDS) {
      if (!this.isCommandEnabled(cmd)) continue;
      const override = this.overrides[cmd];
      effective[cmd] = override ? { ...override } : { ...defaults[cmd] };
    }

    return effective as Record<AppCommand, ShortcutBinding>;
  }

  /**
   * Resolves the effective binding for a single command.
   */
  public resolveBinding(command: AppCommand): ShortcutBinding | null {
    if (!this.isCommandEnabled(command)) return null;
    const effective = this.getEffectiveBindings();
    return effective[command] ?? null;
  }

  /**
   * Finds the unique AppCommand matching a given KeyboardEvent or NormalizedShortcut.
   * Returns null if no registered global command matches.
   */
  public findCommandForEvent(
    event: KeyboardEvent | NormalizedShortcut,
  ): AppCommand | null {
    const normalized: NormalizedShortcut =
      'metaKey' in event
        ? normalizeKeyboardEvent(event as KeyboardEvent)
        : (event as NormalizedShortcut);

    const effective = this.getEffectiveBindings();

    // Prioritize command whose override matches
    for (const cmd of ORDERED_APP_COMMANDS) {
      if (!this.isCommandEnabled(cmd)) continue;
      if (this.overrides[cmd] && matchesBinding(this.overrides[cmd]!, normalized)) {
        return cmd;
      }
    }

    // Next check default bindings that haven't been overridden by another command
    for (const cmd of ORDERED_APP_COMMANDS) {
      if (!this.isCommandEnabled(cmd)) continue;
      const binding = effective[cmd];
      if (binding && matchesBinding(binding, normalized)) {
        return cmd;
      }
    }

    return null;
  }

  /**
   * Validates a candidate shortcut binding in context of the registry.
   */
  public validate(
    binding: ShortcutBinding,
    targetCommand?: AppCommand,
  ): ShortcutValidationResult {
    if (targetCommand && !this.isCommandEnabled(targetCommand)) {
      return {
        allowed: false,
        reason: 'app-safety',
        message: 'Command is not available in this product edition',
      };
    }
    return validateShortcutBinding(binding, {
      isMac: this.isMac,
      targetCommand,
      existingBindings: this.getEffectiveBindings(),
    });
  }

  /**
   * Applies an override for a command.
   * If another command already has this shortcut and replaceConflicting is true,
   * the conflicting command is unbound or reverted to avoid ambiguous dispatch.
   */
  public setOverride(
    command: AppCommand,
    binding: ShortcutBinding,
    replaceConflicting: boolean = false,
  ): { success: boolean; conflictingCommand?: AppCommand } {
    if (!this.isCommandEnabled(command)) {
      return { success: false };
    }
    const validation = this.validate(binding, command);
    if (!validation.allowed) {
      if (validation.reason === 'duplicate-binding' && replaceConflicting) {
        // Deterministic Conflict Resolution:
        // Clear or unassign the conflicting command's assignment
        const conflictCmd = validation.conflictingCommand;
        if (conflictCmd) {
          // If the conflicting command had an override, remove it
          delete this.overrides[conflictCmd];
        }
      } else {
        return {
          success: false,
          conflictingCommand: validation.conflictingCommand,
        };
      }
    }

    // Also check if any existing override conflicts
    for (const cmd of ORDERED_APP_COMMANDS) {
      if (cmd !== command && this.overrides[cmd] && areBindingsEqual(this.overrides[cmd]!, binding)) {
        if (replaceConflicting) {
          delete this.overrides[cmd];
        } else {
          return {
            success: false,
            conflictingCommand: cmd,
          };
        }
      }
    }

    this.overrides[command] = { ...binding };
    this.persist();
    this.notify();
    return { success: true };
  }

  /**
   * Removes user override for a command, restoring its platform default.
   */
  public removeOverride(command: AppCommand): void {
    if (this.overrides[command]) {
      delete this.overrides[command];
      this.persist();
      this.notify();
    }
  }

  /**
   * Resets all navigation overrides (Restore defaults).
   */
  public resetNavigationOverrides(): void {
    this.overrides = {};
    clearShortcutSettings();
    this.notify();
  }

  /**
   * Returns current settings representation for persistence.
   */
  public getSettings(): KeyboardShortcutSettings {
    return {
      version: 1,
      bindings: { ...this.overrides },
    };
  }

  /**
   * Loads and applies settings.
   */
  public loadSettings(settings: KeyboardShortcutSettings): void {
    this.overrides = { ...settings.bindings };
    this.persist();
    this.notify();
  }

  /**
   * Subscribes a listener to registry changes.
   */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private persist(): void {
    saveShortcutSettings(this.getSettings());
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

// Global shared singleton for the application
export const defaultShortcutRegistry = new ShortcutRegistry();
