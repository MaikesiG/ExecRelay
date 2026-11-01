import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';

/**
 * APP-VERSION-001: the running app's version, read from the Tauri app metadata
 * (`native/Cargo.toml` `version`, which `tauri.conf.json` does not override). `null` outside
 * Tauri or when the metadata cannot be read: the UI then shows no version, never a guess.
 */
export async function readAppVersion(
  readMetadataVersion: () => Promise<string> = getVersion,
): Promise<string | null> {
  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  if (!isTauri) return null;
  try {
    const version = (await readMetadataVersion()).trim();
    return version || null;
  } catch {
    return null;
  }
}

export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    readAppVersion().then((value) => {
      if (!cancelled) setVersion(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return version;
}
