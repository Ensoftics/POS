import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpStatus, Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

const HOUR_MS = 3_600_000;

const unavailable = () =>
  new AppException(
    'STORAGE_UNAVAILABLE',
    HttpStatus.SERVICE_UNAVAILABLE,
    'Image storage is not available right now. Try again later.',
  );

/**
 * Private S3-compatible bucket for uploaded files. Nothing in it is publicly
 * readable: files are fetched through short-lived signed URLs.
 */
@Injectable()
export class ObjectStorage implements OnModuleDestroy {
  private readonly logger = new Logger(ObjectStorage.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.bucket = config.S3_BUCKET ?? '';
    this.client = config.S3_BUCKET
      ? new S3Client({
          region: config.S3_REGION,
          ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
          ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
            ? {
                credentials: {
                  accessKeyId: config.S3_ACCESS_KEY_ID,
                  secretAccessKey: config.S3_SECRET_ACCESS_KEY,
                },
              }
            : {}),
        })
      : null;
  }

  get available(): boolean {
    return this.client !== null;
  }

  /** Throws STORAGE_UNAVAILABLE when no bucket is configured. */
  assertAvailable(): void {
    this.require();
  }

  /** Stores a file. Keys hold a fresh id, so a stored file never changes. */
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const client = this.require();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'private, max-age=31536000, immutable',
        }),
      );
    } catch (error) {
      this.logger.warn({ msg: 'object upload failed', key, error: errorName(error) });
      throw unavailable();
    }
  }

  /** Deletes files. Logs and returns false instead of throwing: used for clean-up after commits. */
  async remove(keys: string[]): Promise<boolean> {
    if (!this.client || keys.length === 0) return true;
    try {
      const result = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (result.Errors?.length) {
        this.logger.warn({ msg: 'object delete failed', keys: result.Errors.map((e) => e.Key) });
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn({ msg: 'object delete failed', keys, error: errorName(error) });
      return false;
    }
  }

  /**
   * A signed download URL. The signing time is rounded down to the hour so repeated
   * requests within the hour get the same URL (browser cache hits); it stays valid
   * for at least an hour after it is handed out.
   */
  signedGetUrl(key: string): Promise<string> {
    const client = this.require();
    const signingDate = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS);
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: 2 * 3600,
      signingDate,
    });
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }

  private require(): S3Client {
    if (!this.client) throw unavailable();
    return this.client;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
