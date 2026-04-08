/**
 * storage/index.ts
 *
 * Storage service factory. Returns the configured storage adapter based on
 * the STORAGE_PROVIDER environment variable. Defaults to "local".
 *
 * To add a new provider:
 *   1. Implement StorageService in a new file (e.g. storage/gdrive.ts)
 *   2. Add a case here
 *   3. Set STORAGE_PROVIDER=gdrive in your environment
 */

import { StorageService } from './interface';
import { LocalStorageService } from './local';
import { S3StorageService } from './s3';
import { config } from '../config';
import { logger } from '../utils/logger';

let _instance: StorageService | null = null;

export function getStorageService(): StorageService {
  if (_instance) return _instance;

  const provider = config.storage.provider;
  logger.info('Initialising storage service', { provider });

  switch (provider) {
    case 'local':
      _instance = new LocalStorageService();
      break;
    case 's3':
      _instance = new S3StorageService();
      break;
    default:
      throw new Error(`Unknown storage provider: ${provider}`);
  }

  return _instance;
}

export type { StorageService };
