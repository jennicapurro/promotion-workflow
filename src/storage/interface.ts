/**
 * storage/interface.ts
 *
 * Abstract storage interface. All storage adapters implement this contract,
 * making it straightforward to swap providers (local → S3 → Google Drive)
 * without touching any business logic.
 */

export interface SaveDocumentParams {
  correlationId: string;
  /** Relative folder path within the storage root (e.g. "employees/jane-smith") */
  folderPath: string;
  /** File name including extension (e.g. "Promotion_Letter_Jane_Smith_signed.pdf") */
  fileName: string;
  /** Document content as a Buffer */
  content: Buffer;
}

export interface StorageService {
  /**
   * Saves a document to the specified folder.
   * @returns The full path/URL where the document was saved.
   * @throws If the folder does not exist and cannot be created, or on write failure.
   */
  saveDocument(params: SaveDocumentParams): Promise<string>;

  /**
   * Checks whether a folder exists in storage.
   * Useful for pre-flight checks before attempting to write.
   */
  folderExists(folderPath: string): Promise<boolean>;
}
