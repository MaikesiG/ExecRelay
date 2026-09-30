/**
 * ExecRelay Canonical Edition Configuration & Capability Resolution
 * RELEASE-001: Public Build Separation
 */

import type {
  AppCommand,
  EditionConfig,
  MonitorView,
  ProductCapabilities,
  ExecRelayEdition,
} from './types';

/**
 * Public ExecRelay Terminal v0.1 release capabilities.
 * Strictly limited to Terminal, Capture, Changes, and Verify.
 */
export const TERMINAL_EDITION_CAPABILITIES: ProductCapabilities = Object.freeze({
  terminal: true,
  capture: true,
  changes: true,
  verification: true,
  agents: false,
  governance: false,
  organization: false,
  analytics: false,
});

/**
 * Internal ExecRelay Workbench capabilities.
 * Exposes Agent management, Governance, and active developer surfaces.
 */
export const INTERNAL_EDITION_CAPABILITIES: ProductCapabilities = Object.freeze({
  terminal: true,
  capture: true,
  changes: true,
  verification: true,
  agents: true,
  governance: true,
  organization: false,
  analytics: false,
});

/**
 * Resolves the active product edition deterministically.
 * Priority order:
 * 1. Explicit override passed directly
 * 2. Window global override (e.g. set by test runner: `window.__EXECRELAY_EDITION__` or legacy `window.__TRACERELAY_EDITION__`)
 * 3. Environment variable `VITE_EXECRELAY_EDITION` or legacy `VITE_TRACERELAY_EDITION`
 * 4. Default: 'terminal' (public release)
 */
export function resolveProductEdition(explicitOverride?: ExecRelayEdition): ExecRelayEdition {
  if (explicitOverride === 'terminal' || explicitOverride === 'internal') {
    return explicitOverride;
  }

  if (typeof window !== 'undefined') {
    const win = window as unknown as {
      __EXECRELAY_EDITION__?: unknown;
      __TRACERELAY_EDITION__?: unknown;
    };
    const winVal = win.__EXECRELAY_EDITION__ ?? win.__TRACERELAY_EDITION__;
    if (winVal === 'internal' || winVal === 'terminal') {
      return winVal;
    }
  }

  try {
    const envObj = (import.meta as unknown as { env?: Record<string, string> })?.env;
    const envVal = envObj?.VITE_EXECRELAY_EDITION ?? envObj?.VITE_TRACERELAY_EDITION;
    if (envVal === 'internal' || envVal === 'terminal') {
      return envVal;
    }
  } catch {
    // Environment object not accessible
  }

  return 'terminal';
}

/**
 * Retrieves the product capabilities for a specific edition (or the resolved edition).
 */
export function getProductCapabilities(
  edition: ExecRelayEdition = resolveProductEdition(),
): ProductCapabilities {
  return edition === 'internal'
    ? { ...INTERNAL_EDITION_CAPABILITIES }
    : { ...TERMINAL_EDITION_CAPABILITIES };
}

/**
 * Retrieves the full product edition configuration.
 */
export function getEditionConfig(
  edition: ExecRelayEdition = resolveProductEdition(),
): EditionConfig {
  const capabilities = getProductCapabilities(edition);
  const isTerminal = edition === 'terminal';

  return Object.freeze({
    edition,
    capabilities,
    productName: 'ExecRelay',
    windowTitle: isTerminal ? 'ExecRelay Terminal' : 'ExecRelay (Internal)',
    tagline: 'A terminal that captures what actually happened.',
  });
}

/**
 * Checks whether a specific Monitor view is supported by the capabilities.
 */
export function isMonitorViewEnabled(
  view: MonitorView,
  capabilities: ProductCapabilities = getProductCapabilities(),
): boolean {
  switch (view) {
    case 'capture-evidence':
      return capabilities.capture;
    case 'changes':
      return capabilities.changes;
    case 'verification':
      return capabilities.verification;
    case 'agents':
      return capabilities.agents;
    case 'governance':
      return capabilities.governance;
    default:
      return false;
  }
}

/**
 * Checks whether an AppCommand is supported by the capabilities.
 */
export function isAppCommandEnabled(
  command: AppCommand,
  capabilities: ProductCapabilities = getProductCapabilities(),
): boolean {
  switch (command) {
    case 'focus-terminal':
      return capabilities.terminal;
    case 'focus-capture-evidence':
      return capabilities.capture;
    case 'focus-changes':
      return capabilities.changes;
    case 'focus-verification':
      return capabilities.verification;
    case 'focus-agents':
      return capabilities.agents;
    case 'focus-governance':
      return capabilities.governance;
    default:
      return false;
  }
}

/**
 * Returns the list of enabled Monitor views in deterministic tab-order.
 */
export function getEnabledMonitorViews(
  capabilities: ProductCapabilities = getProductCapabilities(),
): MonitorView[] {
  const allViews: MonitorView[] = [
    'capture-evidence',
    'changes',
    'verification',
    'agents',
    'governance',
  ];
  return allViews.filter((v) => isMonitorViewEnabled(v, capabilities));
}

/**
 * Returns the list of enabled AppCommands in canonical order.
 */
export function getEnabledAppCommands(
  capabilities: ProductCapabilities = getProductCapabilities(),
): AppCommand[] {
  const allCmds: AppCommand[] = [
    'focus-terminal',
    'focus-capture-evidence',
    'focus-changes',
    'focus-verification',
    'focus-agents',
    'focus-governance',
  ];
  return allCmds.filter((cmd) => isAppCommandEnabled(cmd, capabilities));
}
