'use client';

import { useSyncExternalStore } from 'react';
import { projectsStore } from '@/lib/projects-store';
import { walletStore } from '@/lib/wallet-store';

/**
 * Re-render when the wallet changes. The engine mutates the state object in place,
 * so the snapshot is a version counter and callers read `walletStore.get()` right after.
 */
export function useWallet() {
  const version = useSyncExternalStore(walletStore.subscribe, walletStore.getVersion, () => 0);
  return { s: walletStore.get(), version, ready: walletStore.ready, store: walletStore };
}

export function useProjects() {
  const version = useSyncExternalStore(projectsStore.subscribe, projectsStore.getVersion, () => 0);
  return { store: projectsStore, version };
}
