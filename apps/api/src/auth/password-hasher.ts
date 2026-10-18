import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/**
 * scrypt password hashing using Node's built-in crypto (no native add-ons).
 * Format: `scrypt$<logN>$<r>$<p>$<salt b64url>$<hash b64url>` so parameters can be
 * raised later; `needsRehash` reports hashes created with weaker settings.
 */
@Injectable()
export class PasswordHasher {
  private readonly logN: number;
  private dummyHash?: Promise<string>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.logN = config.PASSWORD_HASH_LOG_N;
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await scryptAsync(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      this.options(this.logN, BLOCK_SIZE, PARALLELISM),
    );
    return [
      'scrypt',
      this.logN,
      BLOCK_SIZE,
      PARALLELISM,
      salt.toString('base64url'),
      key.toString('base64url'),
    ].join('$');
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, logN, r, p, saltText, hashText] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const expected = Buffer.from(hashText, 'base64url');
    const key = await scryptAsync(
      password.normalize('NFKC'),
      Buffer.from(saltText, 'base64url'),
      expected.length,
      this.options(Number(logN), Number(r), Number(p)),
    );
    return key.length === expected.length && timingSafeEqual(key, expected);
  }

  needsRehash(stored: string): boolean {
    const [algorithm, logN] = stored.split('$');
    return algorithm !== 'scrypt' || Number(logN) < this.logN;
  }

  /** Burns comparable CPU time when the account does not exist, to blunt user enumeration. */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash(randomBytes(16).toString('hex'));
    await this.verify(password, await this.dummyHash);
  }

  private options(logN: number, r: number, p: number): ScryptOptions {
    const N = 2 ** logN;
    return { N, r, p, maxmem: 256 * N * r + 1024 * 1024 };
  }
}
