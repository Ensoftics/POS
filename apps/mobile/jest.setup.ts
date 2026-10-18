// In-memory SecureStore so session logic can be tested without a device keystore.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

// Offline storage: the SQLite store needs a device, so tests use the in-memory store.
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

// Bluetooth printers: one shared fake manager that tests configure per case.
jest.mock('react-native-ble-plx', () => {
  const manager = {
    state: jest.fn(async () => 'PoweredOn'),
    startDeviceScan: jest.fn(async () => undefined),
    stopDeviceScan: jest.fn(async () => undefined),
    connectToDevice: jest.fn(),
    cancelDeviceConnection: jest.fn(async () => undefined),
  };
  return {
    __manager: manager,
    BleManager: jest.fn(() => manager),
    State: { PoweredOn: 'PoweredOn', PoweredOff: 'PoweredOff' },
  };
});

// Screenshots need a native view; tests supply the captured image.
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));
