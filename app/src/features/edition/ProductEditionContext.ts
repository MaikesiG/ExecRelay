/**
 * TraceRelay Product Edition Context & Hooks
 * RELEASE-001: Public Build Separation
 */

import { createContext, useContext } from 'react';
import type { EditionConfig, ProductCapabilities } from './types';
import { getEditionConfig, getProductCapabilities } from './editionConfig';

export const ProductEditionContext = createContext<EditionConfig>(getEditionConfig());

/**
 * Hook to access the full Product Edition configuration.
 */
export function useProductEdition(): EditionConfig {
  return useContext(ProductEditionContext);
}

/**
 * Hook to access active ProductCapabilities directly.
 */
export function useProductCapabilities(): ProductCapabilities {
  const context = useContext(ProductEditionContext);
  return context?.capabilities ?? getProductCapabilities();
}
