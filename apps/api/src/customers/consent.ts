import { randomInt } from 'node:crypto';
import type { Tx } from '../prisma/prisma.service';
import { RequestContext } from '../common/request-context';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** 12 random characters (~70 bits) for the customer's opt-out link; short enough for an SMS. */
export function newUnsubscribeCode(): string {
  let code = '';
  for (let i = 0; i < 12; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Appends to the consent history: staff changes carry who recorded them and how. */
export async function recordConsent(
  tx: Tx,
  tenantId: string,
  customerId: string,
  granted: boolean,
  note: string | null,
  source: 'STAFF' | 'UNSUBSCRIBE_LINK' = 'STAFF',
): Promise<void> {
  await tx.consentEvent.create({
    data: {
      tenantId,
      customerId,
      granted,
      source,
      note,
      actorUserId: source === 'STAFF' ? (RequestContext.get()?.principal?.userId ?? null) : null,
    },
  });
}
