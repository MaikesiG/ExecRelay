/**
 * ExecRelay Edition & Capabilities Model
 * RELEASE-001: Public Build Separation
 *
 * Defines canonical product editions and capability boundaries.
 * - 'terminal': Public v0.1 release surface (Terminal, Capture, Changes, Verify).
 * - 'internal': Full developer edition (adds Agents, Governance, future surfaces).
 */

import type { AppCommand, MonitorView } from '../shortcuts/types';

export type ExecRelayEdition = 'terminal' | 'internal';
export type TraceRelayEdition = ExecRelayEdition;

export interface ProductCapabilities {
  // Public v0.1 Core Surfaces
  readonly terminal: boolean;
  readonly capture: boolean;
  readonly changes: boolean;
  readonly verification: boolean;

  // Deferred / Internal Surfaces
  readonly agents: boolean;
  readonly governance: boolean;
  readonly organization: boolean;
  readonly analytics: boolean;
}

export interface EditionConfig {
  readonly edition: TraceRelayEdition;
  readonly capabilities: ProductCapabilities;
  readonly productName: string;
  readonly windowTitle: string;
  readonly tagline: string;
}

export type { AppCommand, MonitorView };
