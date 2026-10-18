import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup, configure } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, vi } from 'vitest';
import '../i18n';
import { resetOfflineEngines } from '../lib/offline';

// findBy*/waitFor wait up to 1 s by default; with every suite running in parallel,
// screens sometimes need longer to appear. Waits still end as soon as they succeed.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // Each test starts with empty offline storage.
  resetOfflineEngines();
  globalThis.indexedDB = new IDBFactory();
});
