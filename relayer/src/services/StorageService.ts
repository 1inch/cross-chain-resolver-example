/**
 * Storage service for persistent message tracking
 * Provides secure file-based storage with proper error handling
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { IStorageService } from '../types/interfaces.js';
import { StorageError, ErrorHandler } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class StorageService implements IStorageService {
  private readonly processedMessages: Set<string> = new Set();
  private readonly storageDir: string;
  private readonly filename: string;
  private isInitialized = false;
  // New: message status map for crash-resilient idempotency
  private messageStatus: Map<string, { status: 'started' | 'succeeded' | 'failed'; updatedAt: number; error?: string }>
    = new Map();

  constructor(storageDir: string = 'storage', filename: string = 'processed_messages.json') {
    this.storageDir = this.validateAndNormalizePath(storageDir);
    this.filename = this.validateFilename(filename);
  }

  /**
   * Initialize the storage service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.ensureStorageDirectory();
      
      // Check if the storage file exists, if not create an empty one
      const filePath = this.getStorageFilePath();
      try {
        await fs.access(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // File doesn't exist, create an empty array in it
          await fs.writeFile(filePath, JSON.stringify([], null, 2), 'utf8');
          logger.info('Created new empty storage file', { filePath });
        } else {
          throw error;
        }
      }
      
      await this.loadProcessedMessages();
      this.isInitialized = true;
      logger.info('Storage service initialized successfully', {
        storageDir: this.storageDir,
        filename: this.filename,
        loadedMessages: this.processedMessages.size
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'StorageService initialization failed'
      );
    }
  }

  // New: mark message lifecycle status
  async markMessageStarted(messageId: string): Promise<void> {
    this.validateMessageId(messageId);
    if (!this.isInitialized) {
      await this.initialize();
    }
    this.messageStatus.set(messageId, { status: 'started', updatedAt: Date.now() });
    await this.persistToFile();
  }

  async markMessageSucceeded(messageId: string): Promise<void> {
    this.validateMessageId(messageId);
    if (!this.isInitialized) {
      await this.initialize();
    }
    this.processedMessages.add(messageId);
    this.messageStatus.set(messageId, { status: 'succeeded', updatedAt: Date.now() });
    await this.persistToFile();
  }

  async markMessageFailed(messageId: string, error?: string): Promise<void> {
    this.validateMessageId(messageId);
    if (!this.isInitialized) {
      await this.initialize();
    }
    this.messageStatus.set(messageId, { status: 'failed', updatedAt: Date.now(), error });
    await this.persistToFile();
  }

  getMessageStatus(messageId: string): 'started' | 'succeeded' | 'failed' | undefined {
    return this.messageStatus.get(messageId)?.status;
  }

  /**
   * Save a processed message to persistent storage
   */
  async saveProcessedMessage(messageId: string): Promise<void> {
    try {
      this.validateMessageId(messageId);
      
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Add to in-memory set first
      this.processedMessages.add(messageId);

      // Also track status as succeeded
      this.messageStatus.set(messageId, { status: 'succeeded', updatedAt: Date.now() });

      // Persist to file
      await this.persistToFile();

      logger.debug('Saved processed message', { messageId, totalMessages: this.processedMessages.size });
    } catch (error) {
      throw new StorageError(
        `Failed to save processed message: ${messageId}`,
        'save',
        this.getStorageFilePath(),
        { messageId, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Load processed messages from persistent storage
   */
  async loadProcessedMessages(): Promise<Set<string>> {
    try {
      const filePath = this.getStorageFilePath();

      try {
        await fs.access(filePath);
        const data = await fs.readFile(filePath, 'utf8');
        
        if (!data.trim()) {
          logger.info('Storage file is empty, starting with empty message set');
          return this.processedMessages;
        }

        const parsed = JSON.parse(data);

        // Backward compatibility:
        // v1 format: ["msg1", "msg2", ...]
        // v2 format: { version: 2, messages: { [id]: { status, updatedAt, error? } } }
        if (Array.isArray(parsed)) {
          let validMessages = 0;
          parsed.forEach((messageId: unknown) => {
            if (typeof messageId === 'string' && messageId.trim()) {
              try {
                this.validateMessageId(messageId);
                this.processedMessages.add(messageId);
                this.messageStatus.set(messageId, { status: 'succeeded', updatedAt: Date.now() });
                validMessages++;
              } catch (error) {
                logger.warn('Skipping invalid message ID from storage', { 
                  messageId, 
                  error: error instanceof Error ? error.message : String(error) 
                });
              }
            }
          });
          logger.info('Loaded processed messages (v1 format)', {
            filePath,
            messageCount: validMessages
          });
        } else if (parsed && typeof parsed === 'object' && parsed.messages && typeof parsed.messages === 'object') {
          const entries = Object.entries(parsed.messages as Record<string, { status: string; updatedAt: number; error?: string }>)
            .filter(([id]) => typeof id === 'string' && id.trim());
          let loaded = 0;
          for (const [id, info] of entries) {
            try {
              this.validateMessageId(id);
              if (info?.status === 'succeeded') {
                this.processedMessages.add(id);
              }
              const normalizedStatus = (info?.status === 'started' || info?.status === 'failed' || info?.status === 'succeeded')
                ? info.status as 'started' | 'failed' | 'succeeded' : 'started';
              this.messageStatus.set(id, { status: normalizedStatus, updatedAt: info?.updatedAt || Date.now(), error: info?.error });
              loaded++;
            } catch (err) {
              logger.warn('Skipping invalid message entry from storage', {
                id,
                error: err instanceof Error ? err.message : String(err)
              });
            }
          }
          logger.info('Loaded processed messages (v2 format)', { filePath, messageCount: loaded });
        } else {
          throw new StorageError(
            'Invalid storage format: expected array or object with messages',
            'load',
            filePath,
            { actualType: typeof parsed }
          );
        }

        const total = this.messageStatus.size || this.processedMessages.size;
        const succeeded = this.processedMessages.size;
        logger.info('Loaded processed messages from storage', {
          totalMessages: total,
          succeeded
        });

        return this.processedMessages;
      } catch (accessError: any) {
        if (accessError.code === 'ENOENT') {
          logger.info('No storage file found, starting with empty message set');
          return this.processedMessages;
        }
        throw accessError;
      }
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      
      throw new StorageError(
        'Failed to load processed messages from storage',
        'load',
        this.getStorageFilePath(),
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Check if a message has been processed
   */
  isMessageProcessed(messageId: string): boolean {
    try {
      this.validateMessageId(messageId);
      return this.processedMessages.has(messageId);
    } catch (error) {
      logger.warn('Invalid message ID in isMessageProcessed check', { 
        messageId, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return false;
    }
  }

  /**
   * Get the count of processed messages
   */
  getProcessedMessageCount(): number {
    return this.processedMessages.size;
  }

  /**
   * Clear all processed messages (use with caution)
   */
  async clearProcessedMessages(): Promise<void> {
    try {
      this.processedMessages.clear();
      await this.persistToFile();
      logger.info('Cleared all processed messages');
    } catch (error) {
      throw new StorageError(
        'Failed to clear processed messages',
        'clear',
        this.getStorageFilePath(),
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Get all processed message IDs (for debugging/monitoring)
   */
  getAllProcessedMessages(): string[] {
    return Array.from(this.processedMessages);
  }

  // Private helper methods

  private validateMessageId(messageId: string): void {
    if (!messageId || typeof messageId !== 'string' || !messageId.trim()) {
      throw ErrorHandler.createValidationError(
        'messageId',
        messageId,
        'Message ID must be a non-empty string'
      );
    }

    if (messageId.length > 256) {
      throw ErrorHandler.createValidationError(
        'messageId',
        messageId,
        'Message ID is too long (max 256 characters)'
      );
    }
  }

  private validateFilename(filename: string): string {
    if (!filename || typeof filename !== 'string') {
      throw ErrorHandler.createSecurityError('Invalid filename provided', { filename });
    }

    // Prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw ErrorHandler.createSecurityError('Directory traversal attempt detected', { filename });
    }

    // Ensure filename has safe characters only
    if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) {
      throw ErrorHandler.createSecurityError('Unsafe characters in filename', { filename });
    }

    return filename;
  }

  private validateAndNormalizePath(dirPath: string): string {
    if (!dirPath || typeof dirPath !== 'string') {
      throw ErrorHandler.createSecurityError('Invalid directory path provided', { dirPath });
    }

    // Prevent directory traversal
    if (dirPath.includes('..')) {
      throw ErrorHandler.createSecurityError('Directory traversal attempt detected', { dirPath });
    }

    // Normalize and resolve the path
    const normalizedPath = path.resolve(process.cwd(), dirPath);
    
    // Ensure the path is within the project directory
    const projectRoot = process.cwd();
    if (!normalizedPath.startsWith(projectRoot)) {
      throw ErrorHandler.createSecurityError('Path outside project directory', { 
        dirPath, 
        normalizedPath, 
        projectRoot 
      });
    }

    return normalizedPath;
  }

  private getStorageFilePath(): string {
    return path.join(this.storageDir, this.filename);
  }

  /**
   * Check if a directory exists
   */
  private async directoryExists(path: string): Promise<boolean> {
    try {
      const stats = await fs.stat(path);
      return stats.isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error; // Re-throw unexpected errors
    }
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);
      return stats.isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error; // Re-throw unexpected errors
    }
  }

  private async ensureStorageDirectory(): Promise<void> {
    try {
      logger.debug('Ensuring storage directory exists', { 
        storageDir: this.storageDir,
        cwd: process.cwd()
      });
      
      try {
        // First check if directory exists
        const stats = await fs.stat(this.storageDir);
        
        if (!stats.isDirectory()) {
          throw new Error(`Path exists but is not a directory: ${this.storageDir}`);
        }
        
        logger.debug('Storage directory exists and is accessible', { 
          storageDir: this.storageDir,
          isDirectory: stats.isDirectory(),
          isWritable: true
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          logger.debug('Storage directory does not exist, creating...', { 
            storageDir: this.storageDir 
          });
          
          // Create directory with explicit permissions
          await fs.mkdir(this.storageDir, { 
            recursive: true,
            mode: 0o755 // rwxr-xr-x
          });
          
          logger.info('Created storage directory', { 
            storageDir: this.storageDir,
            created: true
          });
          
          // Verify the directory was created and is writable
          try {
            const testFile = path.join(this.storageDir, '.write-test');
            await fs.writeFile(testFile, 'test');
            await fs.unlink(testFile);
            
            logger.debug('Verified write access to storage directory', {
              storageDir: this.storageDir
            });
          } catch (writeError) {
            const errorMessage = `Failed to write to storage directory '${this.storageDir}': ${writeError instanceof Error ? writeError.message : String(writeError)}`;
            throw new StorageError(
              errorMessage,
              'write',
              this.storageDir,
              { error: errorMessage }
            );
          }
        } else {
          throw error;
        }
      }
    } catch (error) {
      throw new StorageError(
        `Failed to ensure storage directory: ${error instanceof Error ? error.message : String(error)}`,
        'ensureDirectory',
        this.storageDir,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private async persistToFile(): Promise<void> {
    const filePath = this.getStorageFilePath();
    const tempFile = `${filePath}.tmp`;
    const messages = Array.from(this.processedMessages);
    
    logger.debug('Persisting messages to file', {
      filePath,
      messageCount: messages.length,
      storageDir: this.storageDir
    });

    try {
      // Ensure the storage directory exists and is writable
      await this.ensureStorageDirectory();
      
      // Check directory permissions
      const dirStats = await fs.stat(this.storageDir);
      if (!dirStats.isDirectory()) {
        throw new Error(`Storage path is not a directory: ${this.storageDir}`);
      }
      
      // Check write permissions
      try {
        const testFile = path.join(this.storageDir, `.write-test-${Date.now()}`);
        await fs.writeFile(testFile, 'test');
        await fs.unlink(testFile);
      } catch (permError) {
        throw new Error(`No write permission in directory: ${this.storageDir}. ${permError instanceof Error ? permError.message : String(permError)}`);
      }

      // Build v2 payload with statuses; include v1 for backward tools if needed later
      const statusObject: Record<string, { status: string; updatedAt: number; error?: string }> = {};
      this.messageStatus.forEach((info, id) => { statusObject[id] = info; });
      const payload = { version: 2, messages: statusObject };

      // Write to temporary file first (atomic operation)
      const data = JSON.stringify(payload, null, 2);
      logger.debug('Writing to temporary file', { tempFile, dataLength: data.length });
      
      await fs.writeFile(tempFile, data, 'utf8');
      
      // Verify temp file was written
      const tempStats = await fs.stat(tempFile);
      if (tempStats.size === 0) {
        throw new Error('Temporary file was created but is empty');
      }
      
      // On Windows, we need to handle the case where the destination exists
      if (process.platform === 'win32' && await this.fileExists(filePath)) {
        try {
          await fs.unlink(filePath);
        } catch (unlinkError) {
          // If we can't delete the existing file, try renaming it
          const backupFile = `${filePath}.bak-${Date.now()}`;
          logger.warn(`Could not remove existing file, attempting to rename to ${backupFile}`, {
            filePath,
            error: unlinkError instanceof Error ? unlinkError.message : String(unlinkError)
          });
          await fs.rename(filePath, backupFile);
        }
      }
      
      // Rename to final file (atomic on most filesystems)
      logger.debug('Renaming temp file to final location', { 
        tempFile, 
        filePath,
        tempFileSize: tempStats.size
      });
      
      await fs.rename(tempFile, filePath);

      // Verify final file exists and has content
      const finalStats = await fs.stat(filePath);
      if (finalStats.size === 0) {
        throw new Error('Final file was created but is empty');
      }

      logger.info('Successfully persisted messages to storage', { 
        messageCount: messages.length, 
        filePath,
        fileSize: finalStats.size
      });
    } catch (error) {
      // Clean up temp file if it exists
      try {
        if (await this.fileExists(tempFile)) {
          await fs.unlink(tempFile);
        }
      } catch (unlinkError) {
        logger.warn('Failed to clean up temporary file', { 
          tempFile,
          error: unlinkError instanceof Error ? unlinkError.message : String(unlinkError)
        });
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      // Log detailed error information
      const errorContext = {
        filePath,
        error: errorMessage,
        stack: errorStack,
        storageDir: this.storageDir,
        dirExists: await this.directoryExists(this.storageDir),
        fileExists: await this.fileExists(filePath),
        tempFileExists: await this.fileExists(tempFile),
        platform: process.platform,
        nodeVersion: process.version
      };
      
      logger.error('Failed to persist messages to file', errorContext);
      
      throw new StorageError(
        `Failed to persist messages to file: ${errorMessage}`,
        'write',
        filePath,
        { 
          error: errorMessage,
          stack: errorStack,
          storageDir: this.storageDir,
          dirExists: await this.directoryExists(this.storageDir),
          fileExists: await this.fileExists(filePath)
        }
      );
    }
  }
}
