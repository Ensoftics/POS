import { MemoryStore } from '@pos/offline';
import { configure } from '@testing-library/react-native';
import { setOfflineStoreFactory } from './src/lib/offline';

// Each test starts with empty offline storage.
beforeEach(() => {
  setOfflineStoreFactory(() => new MemoryStore());
});

// findBy*/waitFor give up after 1 s by default; printing paces its writes and
// whole suites run in parallel. Waits still end as soon as they succeed.
configure({ asyncUtilTimeout: 5_000 });
