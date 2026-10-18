import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  hotp,
  otpauthUri,
  timeStep,
  verifyTotp,
} from './totp';

// RFC 6238 appendix B test secret (ASCII "12345678901234567890").
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    const vectors: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
    ];
    for (const [seconds, expected] of vectors)
      expect(hotp(RFC_SECRET, Math.floor(seconds / 30), 8)).toBe(expected);
  });

  it('round-trips base32', () => {
    const encoded = base32Encode(RFC_SECRET);
    expect(encoded).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(encoded)).toEqual(RFC_SECRET);
    expect(() => base32Decode('not base32!')).toThrow();
  });

  it('accepts the current code and one step of drift, once only', () => {
    const now = new Date(1_111_111_111_000);
    const step = timeStep(now);
    const code = hotp(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, now, null)).toBe(step);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
    // The same code cannot be used again.
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', now, null)).toBeNull();
  });

  it('encrypts secrets so the stored value reveals nothing and tampering fails', () => {
    const stored = encryptSecret('JBSWY3DPEHPK3PXP', 'a'.repeat(48));
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(stored, 'a'.repeat(48))).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptSecret(stored, 'b'.repeat(48))).toThrow();
    const parts = stored.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), 'a'.repeat(48))).toThrow();
  });

  it('builds an otpauth link for authenticator apps', () => {
    expect(otpauthUri('JBSWY3DPEHPK3PXP', 'ops@example.com')).toBe(
      'otpauth://totp/Ensoftic%20POS%3Aops%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Ensoftic+POS&algorithm=SHA1&digits=6&period=30',
    );
  });
});
