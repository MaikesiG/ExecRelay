/**
 * Centralized Cross-Platform Shortcut Registry & Resolver
 * SHORTCUT-002: Cross-Platform Defaults & Platform-Isolated Overrides
 */

import type {
  AppCommand,
  CommandCategory,
  KeyboardShortcutSettings,
  KeyboardShortcutSettingsV1,
  KeyboardShortcutSettingsV2,
  NormalizedShortcut,
  ShortcutBinding,
  ShortcutCapabilities,
  ShortcutPlatform,
  ShortcutValidationResult,
} from './types';
import { ALL_CONFIGURABLE_COMMANDS, APP_COMMAND_METADATA } from './types';
import { getDefaultShortcuts } from './defaultShortcuts';
import {
  detectPlatform,
  normalizeKeyboardEvent,
  matchesBinding,
  areBindingsEqual,
} from './shortcutNormalization';
import { validateShortcutBinding } from './reservedShortcuts';
import {
  loadShortcutSettings,
  loadPlatformOverrides,
  savePlatformOverrides,
  clearPlatformOverrides,
} from './shortcutPersistence';

export class ShortcutRegistry {
  private platform: ShortcutPlatform;
  private overrides: Partial<Record<AppCommand, ShortcutBinding>>;
  private listeners: Set<() => void>;
  private capabilities?: ShortcutCapabilities;

  constructor(
    platformOrIsMac?: ShortcutPlatform | boolean,
    initialSettingsOrOverrides?:
      | KeyboardShortcutSettings
      | KeyboardShortcutSettingsV1
      | Partial<Record<AppCommand, ShortcutBinding>>,
    capabilities?: ShortcutCapabilities,
  ) {
    if (typeof platformOrIsMac === 'boolean') {
      this.platform = platformOrIsMac ? 'macos' : 'windows';
    } else {
      this.platform = platformOrIsMac ?? detectPlatform();
    }

    this.listeners = new Set();
    this.capabilities = capabilities;

    if (initialSettingsOrOverrides) {
      if ('overrides' in initialSettingsOrOverrides && initialSettingsOrOverrides.overrides) {
        const v2 = initialSettingsOrOverrides as KeyboardShortcutSettingsV2;
        this.overrides = { ...(v2.overrides[this.platform] ?? {}) };
      } else if ('bindings' in initialSettingsOrOverrides && initialSettingsOrOverrides.bindings) {
        const v1 = initialSettingsOrOverrides as KeyboardShortcutSettingsV1;
        this.overrides = { ...(v1.bindings as Partial<Record<AppCommand, ShortcutBinding>>) };
      } else {
        this.overrides = { ...(initialSettingsOrOverrides as Partial<Record<AppCommand, ShortcutBinding>>) };
      }
    } else {
      this.overrides = loadPlatformOverrides(this.platform);
    }
  }

  public getPlatform(): ShortcutPlatform {
    return this.platform;
  }

  public setPlatform(platform: ShortcutPlatform): void {
    if (this.platform !== platform) {
      this.platform = platform;
      this.overrides = loadPlatformOverrides(platform);
      this.notify();
    }
  }

  public getIsMac(): boolean {
    return this.platform === 'macos';
  }

  public getCapabilities(): ShortcutCapabilities | undefined {
    return this.capabilities;
  }

  public setCapabilities(capabilities?: ShortcutCapabilities): void {
    this.capabilities = capabilities;
    this.notify();
  }

  public isCommandEnabled(command: AppCommand): boolean {
    return ALL_CONFIGURABLE_COMMANDS.includes(command);
  }

  /**
   * Computes the effective bindings for all commands on the current platform:
   * Defaults(platform) + User Overrides(platform) = Effective Bindings.
   * Guarantees that at most one command maps to any specific shortcut on this platform.
   */
  public getEffectiveBindings(): Record<AppCommand, ShortcutBinding> {
    const defaults = getDefaultShortcuts(this.platform);
    const effective: Partial<Record<AppCommand, ShortcutBinding>> = {};

    for (const cmd of ALL_CONFIGURABLE_COMMANDS) {
      if (!this.isCommandEnabled(cmd)) continue;
      const override = this.overrides[cmd];
      effective[cmd] = override ? { ...override } : { ...defaults[cmd] };
    }

    return effective as Record<AppCommand, ShortcutBinding>;
  }

  /**
   * Resolves the effective binding for a single command on the active platform.
   */
  public resolveBinding(command: AppCommand): ShortcutBinding | null {
    if (!this.isCommandEnabled(command)) return null;
    const effective = this.getEffectiveBindings();
    return effective[command] ?? null;
  }

  /**
   * Finds the unique AppCommand matching a given KeyboardEvent or NormalizedShortcut
   * under current platform bindings.
   * Can optionally filter by category ('navigation' or 'terminal').
   * Returns null if no registered command matches.
   */
  public findCommandForEvent(
    event: KeyboardEvent | NormalizedShortcut,
    category?: CommandCategory,
  ): AppCommand | null {
    const normalized: NormalizedShortcut =
      'metaKey' in event
        ? normalizeKeyboardEvent(event as KeyboardEvent)
        : (event as NormalizedShortcut);

    const effective = this.getEffectiveBindings();

    // 1. Check user overrides first
    for (const cmd of ALL_CONFIGURABLE_COMMANDS) {
      if (!this.isCommandEnabled(cmd)) continue;
      if (category && APP_COMMAND_METADATA[cmd]?.category !== category) continue;
      if (this.overrides[cmd] && matchesBinding(this.overrides[cmd]!, normalized)) {
        return cmd;
      }
    }

    // 2. Check defaults that haven't been overridden
    for (const cmd of ALL_CONFIGURABLE_COMMANDS) {
      if (!this.isCommandEnabled(cmd)) continue;
      if (category && APP_COMMAND_METADATA[cmd]?.category !== category) continue;
      const binding = effective[cmd];
      if (binding && matchesBinding(binding, normalized)) {
        return cmd;
      }
    }

    return null;
  }

  /**
   * Validates a candidate shortcut binding in context of the active platform registry.
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
      platform: this.platform,
      targetCommand,
      existingBindings: this.getEffectiveBindings(),
    });
  }

  /**
   * Applies an override for a command on the active platform.
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
        const conflictCmd = validation.conflictingCommand;
        if (conflictCmd) {
          delete this.overrides[conflictCmd];
        }
      } else {
        return {
          success: false,
          conflictingCommand: validation.conflictingCommand,
        };
      }
    }

    for (const cmd of ALL_CONFIGURABLE_COMMANDS) {
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
   * Applies an entire set of overrides atomically on the active platform.
   * Performs validation across all bindings before committing.
   */
  public applyOverrides(
    newOverrides: Partial<Record<AppCommand, ShortcutBinding>>,
  ): { success: boolean; errors?: string[] } {
    const errors: string[] = [];
    const enabled = ALL_CONFIGURABLE_COMMANDS.filter((cmd) => this.isCommandEnabled(cmd));
    const defaults = getDefaultShortcuts(this.platform);

    const prospective: Partial<Record<AppCommand, ShortcutBinding>> = {};
    for (const cmd of enabled) {
      prospective[cmd] = newOverrides[cmd] ? { ...newOverrides[cmd]! } : { ...defaults[cmd] };
    }

    // Check pairwise uniqueness
    for (let i = 0; i < enabled.length; i++) {
      for (let j = i + 1; j < enabled.length; j++) {
        const cmdA = enabled[i];
        const cmdB = enabled[j];
        if (areBindingsEqual(prospective[cmdA]!, prospective[cmdB]!)) {
          errors.push(`Conflict: ${cmdA} and ${cmdB} share the same shortcut`);
        }
      }
    }

    // Check safety validation
    for (const cmd of enabled) {
      const binding = prospective[cmd]!;
      const val = validateShortcutBinding(binding, {
        platform: this.platform,
        targetCommand: cmd,
        existingBindings: prospective,
      });
      if (!val.allowed) {
        errors.push(val.message ?? `Invalid shortcut for ${cmd}`);
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    this.overrides = {};
    for (const cmd of enabled) {
      if (newOverrides[cmd] && !areBindingsEqual(newOverrides[cmd]!, defaults[cmd])) {
        this.overrides[cmd] = { ...newOverrides[cmd]! };
      }
    }

    this.persist();
    this.notify();
    return { success: true };
  }

  /**
   * Removes user override for a command on current platform, restoring its default.
   */
  public removeOverride(command: AppCommand): void {
    if (this.overrides[command]) {
      delete this.overrides[command];
      this.persist();
      this.notify();
    }
  }

  /**
   * Resets overrides for the current active platform only.
   * Preserves stored overrides for all other operating systems.
   */
  public resetPlatformOverrides(): void {
    this.overrides = {};
    clearPlatformOverrides(this.platform);
    this.notify();
  }

  /**
   * Backward-compatible alias for resetPlatformOverrides.
   */
  public resetNavigationOverrides(): void {
    this.resetPlatformOverrides();
  }

  /**
   * Returns current settings representation for persistence.
   */
  public getSettings(): KeyboardShortcutSettingsV2 {
    const full = loadShortcutSettings(this.platform);
    return {
      version: 2,
      overrides: {
        ...full.overrides,
        [this.platform]: { ...this.overrides },
      },
      bindings: { ...this.overrides },
    };
  }

  /**
   * Loads and applies settings.
   */
  public loadSettings(settings: KeyboardShortcutSettings): void {
    if (settings.version === 2 && settings.overrides) {
      this.overrides = { ...(settings.overrides[this.platform] ?? {}) };
    } else if ('bindings' in settings) {
      this.overrides = { ...(settings as unknown as KeyboardShortcutSettingsV1).bindings };
    }
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
    savePlatformOverrides(this.platform, this.overrides);
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
