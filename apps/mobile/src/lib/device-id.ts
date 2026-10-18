import * as SecureStore from 'expo-secure-store';
import { newSaleId } from './checkout';

const DEVICE_ID_KEY = 'pos.device.id';
let cached: string | null = null;

/**
 * This install's device id: a random UUID created on first use and kept in
 * SecureStore. It is sent at sign-in and when choosing a register, so an owner can
 * block a lost or stolen till. It identifies the install, not the hardware;
 * reinstalling the app produces a new id (and the till must be set up again).
 */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (stored) return (cached = stored);
  const id = newSaleId();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  return (cached = id);
}

/** Test hook: forget the in-memory copy. */
export function resetDeviceIdCache(): void {
  cached = null;
}
