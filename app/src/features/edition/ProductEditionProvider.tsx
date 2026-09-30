/**
 * TraceRelay Product Edition Provider Component
 * RELEASE-001: Public Build Separation
 */

import { useMemo, type ReactNode } from 'react';
import type { ProductCapabilities, TraceRelayEdition } from './types';
import { getEditionConfig, resolveProductEdition } from './editionConfig';
import { ProductEditionContext } from './ProductEditionContext';

export interface ProductEditionProviderProps {
  edition?: TraceRelayEdition;
  capabilities?: Partial<ProductCapabilities>;
  children: ReactNode;
}

export function ProductEditionProvider({
  edition,
  capabilities: capabilitiesOverride,
  children,
}: ProductEditionProviderProps) {
  const baseConfig = useMemo(() => {
    return getEditionConfig(edition ?? resolveProductEdition());
  }, [edition]);

  const config = useMemo(() => {
    if (!capabilitiesOverride) return baseConfig;
    return {
      ...baseConfig,
      capabilities: {
        ...baseConfig.capabilities,
        ...capabilitiesOverride,
      },
    };
  }, [baseConfig, capabilitiesOverride]);

  return (
    <ProductEditionContext.Provider value={config}>
      {children}
    </ProductEditionContext.Provider>
  );
}
