import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { type AppConfig, loadConfig } from '../config/app-config';

/**
 * Creates the image bucket when it does not exist yet (local development and CI).
 * Production buckets are created with the provider's tooling, private, with
 * versioning and lifecycle rules set there.
 *
 *   pnpm --filter @pos/api storage:init
 */
export async function ensureBucket(config: AppConfig): Promise<'exists' | 'created'> {
  if (!config.S3_BUCKET) throw new Error('S3_BUCKET is not set.');
  const client = new S3Client({
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
  });
  try {
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
      return 'exists';
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
      return 'created';
    }
  } finally {
    client.destroy();
  }
}

if (require.main === module) {
  const config = loadConfig();
  ensureBucket(config)
    .then((result) => process.stdout.write(`Bucket ${config.S3_BUCKET}: ${result}\n`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
