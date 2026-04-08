/**
 * storage/s3.ts
 *
 * AWS S3 storage adapter (stub — ready to activate).
 *
 * TO ACTIVATE:
 *   1. npm install @aws-sdk/client-s3
 *   2. Set STORAGE_PROVIDER=s3 and all S3_* env vars
 *   3. Uncomment the implementation below
 *   4. The rest of the codebase requires no changes (interface is identical)
 *
 * Documents are stored at: s3://<S3_BUCKET>/<S3_KEY_PREFIX><folderPath>/<fileName>
 */

import { StorageService, SaveDocumentParams } from './interface';
import { config } from '../config';
import { logger } from '../utils/logger';

export class S3StorageService implements StorageService {
  async saveDocument(params: SaveDocumentParams): Promise<string> {
    const log = logger.child({ correlationId: params.correlationId });

    // TODO: activate when @aws-sdk/client-s3 is installed
    // import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
    //
    // const s3 = new S3Client({
    //   region: config.storage.s3.region,
    //   credentials: {
    //     accessKeyId: config.storage.s3.accessKeyId,
    //     secretAccessKey: config.storage.s3.secretAccessKey,
    //   },
    // });
    //
    // const key = `${config.storage.s3.keyPrefix}${params.folderPath}/${params.fileName}`;
    //
    // await s3.send(new PutObjectCommand({
    //   Bucket: config.storage.s3.bucket,
    //   Key: key,
    //   Body: params.content,
    //   ContentType: 'application/pdf',
    //   ServerSideEncryption: 'AES256',
    //   Tagging: `correlationId=${params.correlationId}`,
    // }));
    //
    // const s3Uri = `s3://${config.storage.s3.bucket}/${key}`;
    // log.info('Document saved to S3', { s3Uri });
    // return s3Uri;

    throw new Error('S3StorageService is not yet activated. See storage/s3.ts for instructions.');
  }

  async folderExists(_folderPath: string): Promise<boolean> {
    // S3 has no real "folders" — always return true and let PutObject create the path
    return true;
  }
}
