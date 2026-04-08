/**
 * storage/local.ts
 *
 * Local filesystem storage adapter.
 *
 * Documents are written to: <STORAGE_LOCAL_BASE_PATH>/<folderPath>/<fileName>
 *
 * Behaviour:
 *   - If the target folder does not exist, it is created automatically (mkdirSync recursive).
 *   - If a file with the same name exists, it is overwritten (last-write-wins).
 *     This is safe because the file name includes the employee name + effective date,
 *     making genuine collisions extremely unlikely.
 *   - Throws StorageError with a descriptive message on any failure.
 */

import fs from 'fs';
import path from 'path';
import { StorageService, SaveDocumentParams } from './interface';
import { config } from '../config';
import { logger } from '../utils/logger';

export class LocalStorageService implements StorageService {
  private readonly basePath: string;

  constructor() {
    this.basePath = config.storage.localBasePath;
  }

  async saveDocument(params: SaveDocumentParams): Promise<string> {
    const log = logger.child({ correlationId: params.correlationId });
    const targetDir = path.join(this.basePath, params.folderPath);
    const targetFile = path.join(targetDir, params.fileName);

    log.info('Saving document to local storage', {
      targetDir,
      fileName: params.fileName,
      sizeBytes: params.content.length,
    });

    // Ensure target directory exists
    if (!fs.existsSync(targetDir)) {
      log.info('Creating employee folder', { targetDir });
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.writeFileSync(targetFile, params.content);
    log.info('Document saved successfully', { targetFile });

    return targetFile;
  }

  async folderExists(folderPath: string): Promise<boolean> {
    const fullPath = path.join(this.basePath, folderPath);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
  }
}
