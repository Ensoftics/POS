import type { Branch } from '@pos/contracts';
import * as SecureStore from 'expo-secure-store';

/**
 * The register this device sells from, remembered per tenant. The choice is also
 * enrolled with the server (PUT /devices/:id) when made; the local copy is
 * re-validated against live branch data on every load.
 */
export interface DeviceRegister {
  branchId: string;
  branchCode: string;
  branchName: string;
  registerId: string;
  registerCode: string;
  registerName: string;
}

const keyFor = (tenantId: string) => `pos.register.${tenantId}`;

export async function readDeviceRegister(tenantId: string): Promise<DeviceRegister | null> {
  const raw = await SecureStore.getItemAsync(keyFor(tenantId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DeviceRegister;
  } catch {
    return null;
  }
}

export async function saveDeviceRegister(tenantId: string, value: DeviceRegister): Promise<void> {
  await SecureStore.setItemAsync(keyFor(tenantId), JSON.stringify(value));
}

export async function clearDeviceRegister(tenantId: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(tenantId)).catch(() => undefined);
}

export function toDeviceRegister(branch: Branch, registerId: string): DeviceRegister | null {
  const register = branch.registers.find((r) => r.id === registerId);
  if (!register) return null;
  return {
    branchId: branch.id,
    branchCode: branch.code,
    branchName: branch.name,
    registerId: register.id,
    registerCode: register.code,
    registerName: register.name,
  };
}

/**
 * Returns the stored selection refreshed with current names, or null when the
 * register or its branch was archived (the stored value is then cleared).
 */
export async function resolveDeviceRegister(
  tenantId: string,
  activeBranches: Branch[],
): Promise<DeviceRegister | null> {
  const stored = await readDeviceRegister(tenantId);
  if (!stored) return null;
  const branch = activeBranches.find((b) => b.id === stored.branchId && b.status === 'ACTIVE');
  const register = branch?.registers.find(
    (r) => r.id === stored.registerId && r.status === 'ACTIVE',
  );
  if (!branch || !register) {
    await clearDeviceRegister(tenantId);
    return null;
  }
  const current = toDeviceRegister(branch, register.id)!;
  if (JSON.stringify(current) !== JSON.stringify(stored))
    await saveDeviceRegister(tenantId, current);
  return current;
}
