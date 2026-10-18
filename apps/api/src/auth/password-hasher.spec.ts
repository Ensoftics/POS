import type { AppConfig } from '../config/app-config';
import { PasswordHasher } from './password-hasher';

const hasher = (logN: number) => new PasswordHasher({ PASSWORD_HASH_LOG_N: logN } as AppConfig);

describe('PasswordHasher', () => {
  it('verifies the original password and rejects others', async () => {
    const h = hasher(12);
    const stored = await h.hash('correct horse battery');
    expect(stored).toMatch(/^scrypt\$12\$8\$1\$/);
    await expect(h.verify('correct horse battery', stored)).resolves.toBe(true);
    await expect(h.verify('correct horse batterY', stored)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const h = hasher(12);
    expect(await h.hash('same-password-here')).not.toBe(await h.hash('same-password-here'));
  });

  it('normalises Unicode so equivalent input verifies', async () => {
    const h = hasher(12);
    const stored = await h.hash('café-password-1');
    await expect(h.verify('café-password-1', stored)).resolves.toBe(true);
  });

  it('rejects malformed hashes without throwing', async () => {
    await expect(hasher(12).verify('x', 'bcrypt$whatever')).resolves.toBe(false);
  });

  it('flags hashes weaker than the current cost for upgrade', async () => {
    const weak = await hasher(12).hash('password-to-upgrade');
    expect(hasher(14).needsRehash(weak)).toBe(true);
    expect(hasher(12).needsRehash(weak)).toBe(false);
  });
});
