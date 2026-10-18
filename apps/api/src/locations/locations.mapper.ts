import type { Branch as BranchRow, Register as RegisterRow } from '@prisma/client';
import type { Branch, Register } from '@pos/contracts';

export function toRegister(row: RegisterRow): Register {
  return {
    id: row.id,
    branchId: row.branchId,
    code: row.code,
    name: row.name,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toBranch(row: BranchRow & { registers: RegisterRow[] }): Branch {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    addressLine1: row.addressLine1,
    city: row.city,
    phone: row.phone,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    registers: row.registers.map(toRegister),
  };
}
