import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RealmAuth } from './realm-auth';
import { SupportedMimeType } from '@cardstack/runtime-common/router';

export class LocalFileSystem {
  private localStoragePath: string = '';
  private realmUrlToLocalPath: Map<string, string> = new Map();
  private fileWatchers: Map<string, vscode.FileSystemWatcher> = new Map();
  private syncInProgress: boolean = false;
  private userId: string | null = null;

  constructor(
    private context: vscode.ExtensionContext,
    private realmAuth: RealmAuth,
    userId: string | null = null,
  ) {
    this.userId = userId;
    this.updateLocalStoragePath();
    this.loadExistingRealmMappings();
  }

  // Load existing realm mappings from the file system
  private loadExistingRealmMappings(): void {
    try {
      const rootPath = this.getLocalStoragePath();
      if (!fs.existsSync(rootPath)) {
        return;
      }

      console.log(
        `[LocalFileSystem] Loading existing realm mappings from: ${rootPath}`,
      );
      const entries = fs.readdirSync(rootPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const folderPath = path.join(rootPath, entry.name);
          try {
            const metadataPath = path.join(folderPath, '.boxel-realm.json');
            if (fs.existsSync(metadataPath)) {
              const metadata = JSON.parse(
                fs.readFileSync(metadataPath, 'utf8'),
              );
              if (metadata && metadata.realmUrl) {
                // Skip realms belonging to other users if we have a userId
                if (
                  this.userId &&
                  metadata.userId &&
                  metadata.userId !== this.userId
                ) {
                  continue;
                }

                // Add to our mapping
                this.realmUrlToLocalPath.set(metadata.realmUrl, folderPath);
                console.log(
                  `[LocalFileSystem] Mapped realm URL: ${metadata.realmUrl} to ${folderPath}`,
                );

                // If file watching is enabled, start it
                if (metadata.fileWatchingEnabled === true) {
                  this.enableFileWatching(folderPath);
                }
              }
            }
          } catch (error) {
            console.error(
              `[LocalFileSystem] Error processing realm folder ${folderPath}:`,
              error,
            );
            // Continue to next folder even if this one had an error
          }
        }
      }

      console.log(
        `[LocalFileSystem] Loaded ${this.realmUrlToLocalPath.size} realm mappings`,
      );
    } catch (error) {
      console.error(`[LocalFileSystem] Error loading realm mappings:`, error);
    }
  }

  // Refresh all realm mappings (can be called from outside)
  refreshRealmMappings(): void {
    // Clear existing mappings
    this.realmUrlToLocalPath.clear();
    // Reload mappings from disk
    this.loadExistingRealmMappings();
  }

  // Update the local storage path from settings
  updateLocalStoragePath(): void {
    const config = vscode.workspace.getConfiguration('boxel-tools');
    let storagePath =
      config.get<string>('localStoragePath') ||
      '${workspaceFolder}/.boxel-realms';

    // Handle tilde expansion for home directory
    if (storagePath.startsWith('~/') || storagePath === '~') {
      const homedir = os.homedir();
      storagePath = storagePath.replace(/^~(?=$|\/|\\)/, homedir);
    }

    // Replace ${workspaceFolder} with the actual workspace folder path if available
    if (
      storagePath.includes('${workspaceFolder}') &&
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      storagePath = storagePath.replace(
        '${workspaceFolder}',
        vscode.workspace.workspaceFolders[0].uri.fsPath,
      );
    }

    this.localStoragePath = storagePath;

    // Create the directory if it doesn't exist
    try {
      if (!fs.existsSync(this.localStoragePath)) {
        fs.mkdirSync(this.localStoragePath, { recursive: true });
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to create storage directory: ${errorMessage}. Please check your permissions or choose a different path in settings.`,
      );
      // Use a fallback to temp directory
      this.localStoragePath = path.join(os.tmpdir(), 'boxel-realms');
      if (!fs.existsSync(this.localStoragePath)) {
        fs.mkdirSync(this.localStoragePath, { recursive: true });
      }
      vscode.window.showInformationMessage(
        `Using temporary directory instead: ${this.localStoragePath}`,
      );
    }
  }

  // Get the base storage path without user nesting
  getBaseStoragePath(): string {
    return this.localStoragePath;
  }

  // Get the current local storage path
  getLocalStoragePath(): string {
    // If we have a userId, create a user-specific subfolder
    if (this.userId) {
      // Create a safe directory name from the user ID
      const safeUserId = this.userId.replace(/[^a-zA-Z0-9_-]/g, '_');

      console.log(
        `[LocalFileSystem] Using user-specific path for ${this.userId}`,
      );

      // Create the user-specific directory if it doesn't exist
      const userPath = path.join(this.localStoragePath, safeUserId);
      if (!fs.existsSync(userPath)) {
        fs.mkdirSync(userPath, { recursive: true });
        console.log(`[LocalFileSystem] Created user directory: ${userPath}`);
      }

      return userPath;
    }

    console.log(
      '[LocalFileSystem] No user ID available, using base path:',
      this.localStoragePath,
    );

    // Return the base path if no user ID is available
    return this.localStoragePath;
  }

  // Get the local path for a realm
  getLocalPathForRealm(realmUrl: string, realmName: string): string {
    // Create a safe directory name from the realm name
    const safeDirName = realmName.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Get the base storage path (which may already include the user ID)
    const basePath = this.getLocalStoragePath();
    const localPath = path.join(basePath, safeDirName);

    // Store the mapping for future reference
    this.realmUrlToLocalPath.set(realmUrl, localPath);

    // Create the directory if it doesn't exist
    if (!fs.existsSync(localPath)) {
      fs.mkdirSync(localPath, { recursive: true });
    }

    return localPath;
  }

  // Create or update the realm metadata file
  private createMetadataFile(
    localPath: string,
    realmUrl: string,
    realmName: string,
  ): void {
    const metadataPath = path.join(localPath, '.boxel-realm.json');
    const metadata = {
      realmUrl,
      realmName,
      lastSync: null, // No files synced yet
      fileWatchingEnabled: false,
      userId: this.userId, // Store the user ID in metadata
    };

    try {
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
      console.log(`Created realm metadata file at ${metadataPath}`);
    } catch (error) {
      console.error(`Error creating metadata file: ${error}`);
    }
  }

  // Update last sync timestamp in metadata
  private updateLastSyncTimestamp(localPath: string): void {
    const metadataPath = path.join(localPath, '.boxel-realm.json');

    try {
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        metadata.lastSync = new Date().toISOString();
        fs.writeFileSync(
          metadataPath,
          JSON.stringify(metadata, null, 2),
          'utf8',
        );
      }
    } catch (error) {
      console.error(`Error updating lastSync timestamp: ${error}`);
    }
  }

  // Read metadata from a realm directory
  readRealmMetadata(localPath: string): any | null {
    const metadataPath = path.join(localPath, '.boxel-realm.json');

    try {
      if (fs.existsSync(metadataPath)) {
        const content = fs.readFileSync(metadataPath, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error(`Error reading metadata file: ${error}`);
    }

    return null;
  }

  // Update file watching status in metadata
  updateFileWatchingStatus(localPath: string, enabled: boolean): void {
    const metadataPath = path.join(localPath, '.boxel-realm.json');

    try {
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        metadata.fileWatchingEnabled = enabled;
        metadata.lastUpdated = new Date().toISOString();
        fs.writeFileSync(
          metadataPath,
          JSON.stringify(metadata, null, 2),
          'utf8',
        );
      }
    } catch (error) {
      console.error(`Error updating metadata file: ${error}`);
    }
  }

  // Sync data from remote to local
  async syncFromRemote(realmUrl: string, realmName: string): Promise<void> {
    if (this.syncInProgress) {
      console.log('Sync already in progress, skipping');
      return;
    }

    this.syncInProgress = true;

    try {
      console.log(`Starting sync from remote for realm: ${realmName}`);

      const localPath = this.getLocalPathForRealm(realmUrl, realmName);
      const filesProcessed: Set<string> = new Set();
      const directoryStack: string[] = [];
      let currentDirectory = '';
      let filesSkipped = 0;
      let filesDownloaded = 0;

      // Create or update metadata file
      this.createMetadataFile(localPath, realmUrl, realmName);

      // Process root directory to recursively sync all files with progress
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Syncing realm ${realmName}`,
          cancellable: false,
        },
        async (progress) => {
          // Initial progress message
          progress.report({
            message: 'Starting sync...',
            increment: 0,
          });

          // Create a message for the current status
          const updateProgressMessage = () => {
            let message = '';

            // Add file counts
            if (filesDownloaded > 0 || filesSkipped > 0) {
              message += `Files: ${filesDownloaded} downloaded, ${filesSkipped} unchanged`;
            }

            // Add current directory if available
            if (currentDirectory) {
              // Trim very long directory paths
              const displayDir =
                currentDirectory.length > 30
                  ? '...' +
                    currentDirectory.substring(currentDirectory.length - 30)
                  : currentDirectory;

              message += `\nProcessing: ${displayDir}`;

              // Add directory depth indicator
              if (directoryStack.length > 0) {
                message += ` (depth: ${directoryStack.length})`;
              }
            }

            return message;
          };

          await this.processRemoteDirectory(
            realmUrl,
            '/',
            localPath,
            filesProcessed,
            {
              reportFileStatus: (status) => {
                // Update counts based on file status
                if (status === 'downloaded') {
                  filesDownloaded++;
                } else if (status === 'skipped') {
                  filesSkipped++;
                }

                // Report progress without incrementing the bar
                progress.report({
                  message: updateProgressMessage(),
                });
              },
              reportDirectoryStart: (dir) => {
                // Keep track of current directory and directory stack
                currentDirectory = dir;
                directoryStack.push(dir);

                // Report progress
                progress.report({
                  message: updateProgressMessage(),
                });
              },
              reportDirectoryEnd: (dir) => {
                // Remove from stack and update current directory
                const index = directoryStack.indexOf(dir);
                if (index !== -1) {
                  directoryStack.splice(index, 1);
                }

                // Set current directory to the parent directory (top of stack)
                currentDirectory =
                  directoryStack.length > 0
                    ? directoryStack[directoryStack.length - 1]
                    : '';

                // Report progress
                progress.report({
                  message: updateProgressMessage(),
                });
              },
            },
          );

          // Final progress message
          const totalFiles = filesDownloaded + filesSkipped;
          progress.report({
            message: `Sync complete. ${totalFiles} files processed (${filesDownloaded} downloaded, ${filesSkipped} unchanged)`,
            increment: 100,
          });
        },
      );

      if (filesProcessed.size === 0) {
        vscode.window.showWarningMessage(
          `No files were found in realm "${realmName}". This might be an empty realm.`,
        );
      } else {
        console.log(
          `Sync completed for realm: ${realmName}, ${filesProcessed.size} files processed`,
        );

        // Update the last sync timestamp
        this.updateLastSyncTimestamp(localPath);

        // Show a notification
        vscode.window.showInformationMessage(
          `Successfully synced realm "${realmName}" to local storage (${filesProcessed.size} files, ${filesDownloaded} downloaded, ${filesSkipped} unchanged)`,
        );
      }
    } catch (error: unknown) {
      console.error(`Error syncing from remote:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Error syncing realm: ${errorMessage}`);
    } finally {
      this.syncInProgress = false;
    }
  }

  // Process a remote directory recursively
  private async processRemoteDirectory(
    realmUrl: string,
    remotePath: string,
    localBasePath: string,
    filesProcessed: Set<string> = new Set(),
    progress?: {
      reportFileStatus: (status: 'skipped' | 'downloaded') => void;
      reportDirectoryStart: (dir: string) => void;
      reportDirectoryEnd: (dir: string) => void;
    },
  ): Promise<void> {
    // Report directory start
    if (progress) {
      progress.reportDirectoryStart(remotePath);
    }

    console.log(`Processing remote directory: ${remotePath}`);

    // remove leading slash if present
    const apiPath = remotePath.startsWith('/')
      ? remotePath.substring(1)
      : remotePath;

    // Construct the full API URL
    let apiUrl = new URL(apiPath, realmUrl).href;
    // Ensure path has trailing slash for directory listings
    apiUrl = apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`;
    console.log(`API URL: ${apiUrl}`);

    try {
      // Create the local directory if it doesn't exist
      const localDirPath = path.join(localBasePath, remotePath);
      if (!fs.existsSync(localDirPath)) {
        fs.mkdirSync(localDirPath, { recursive: true });
      }

      // Fetch the directory listing
      const response = await fetch(apiUrl, {
        headers: {
          Accept: 'application/vnd.api+json',
          Authorization: `${await this.realmAuth.getJWT(apiUrl)}`,
        },
      });

      if (!response.ok) {
        console.log(
          `Directory API returned ${response.status}: ${response.statusText}`,
        );
        if (progress) {
          progress.reportDirectoryEnd(remotePath);
        }
        return;
      }

      const data = await response.json();
      console.log('Directory data structure:', Object.keys(data));

      // Process directory entries - JSON API format
      if (data.data && data.data.relationships) {
        console.log('Processing JSON API format directory listing');

        for (const [name, info] of Object.entries(data.data.relationships)) {
          // Skip our metadata file
          if (name === '.boxel-realm.json') {
            continue;
          }

          const entry = info as {
            meta: { kind: string; lastModified?: number };
          };
          const isFile = entry.meta.kind === 'file';
          const entryPath = path.posix.join(remotePath, name);
          console.log(
            `Processing entry: ${entryPath}, meta: ${JSON.stringify(
              entry.meta,
            )}`,
          );

          if (isFile) {
            console.log(`Processing file: ${entryPath}`);
            // Download the file, passing the lastModified from the directory listing
            const fileUrl = `${realmUrl}${entryPath}`;
            const localFilePath = path.join(localBasePath, entryPath);

            // Get the lastModified timestamp from the entry metadata
            const lastModified = entry.meta.lastModified
              ? new Date(entry.meta.lastModified * 1000)
              : undefined;

            // Log the timestamp information
            if (lastModified) {
              console.log(
                `File timestamp from directory listing: ${lastModified.toISOString()} (Unix: ${
                  entry.meta.lastModified
                })`,
              );
            } else {
              console.log(
                `No lastModified timestamp in directory entry for: ${entryPath}`,
              );
            }

            const success = await this.downloadFile(
              fileUrl,
              localFilePath,
              filesProcessed,
              progress ? progress.reportFileStatus : undefined,
              lastModified,
            );
          } else {
            console.log(`Processing subdirectory: ${entryPath}`);
            // Process subdirectory
            await this.processRemoteDirectory(
              realmUrl,
              entryPath,
              localBasePath,
              filesProcessed,
              progress,
            );
          }
        }
      } else {
        console.log('Directory listing format not recognized');
      }
    } catch (error) {
      console.error(`Error processing directory ${remotePath}:`, error);
      // Don't throw the error, just log it and continue
      vscode.window.showWarningMessage(
        `Warning: Could not process directory ${remotePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Report directory end
    if (progress) {
      progress.reportDirectoryEnd(remotePath);
    }
  }

  // Download a file from a specific URL
  private async downloadFile(
    url: string,
    localFilePath: string,
    filesProcessed: Set<string>,
    progressCallback?: (status: 'skipped' | 'downloaded') => void,
    remoteLastModified?: Date,
  ): Promise<boolean> {
    console.log(`Processing file: ${url}`);

    try {
      // Ensure parent directory exists
      const dirPath = path.dirname(localFilePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // Check if local file exists and compare modification times
      if (fs.existsSync(localFilePath) && remoteLastModified) {
        const localStats = fs.statSync(localFilePath);
        const localLastModified = localStats.mtime;

        // Log timestamps for debugging
        console.log(`File: ${url}`);
        console.log(
          `  Local timestamp: ${localLastModified.toISOString()} (${localLastModified.getTime()})`,
        );
        console.log(
          `  Remote timestamp: ${remoteLastModified.toISOString()} (${remoteLastModified.getTime()})`,
        );

        // If local file is newer or same age as remote file, skip downloading
        if (localLastModified >= remoteLastModified) {
          console.log(`  SKIPPING: Local file is newer or same age as remote`);

          // Calculate relative path for tracking processed files
          const localBasePath = path.dirname(path.dirname(localFilePath));
          const relativePath = localFilePath.substring(localBasePath.length);
          filesProcessed.add(relativePath);

          if (progressCallback) {
            progressCallback('skipped');
          }

          return true;
        }

        console.log(`  DOWNLOADING: Local file is older than remote`);
      }

      // Get the JWT for authentication
      const jwt = await this.realmAuth.getJWT(url);

      // Fetch the file content
      const response = await fetch(url, {
        headers: {
          Accept: SupportedMimeType.CardSource,
          Authorization: jwt,
        },
      });

      if (!response.ok) {
        console.log(
          `Failed to download file: ${response.status} ${response.statusText}`,
        );
        return false;
      }

      // Get content based on content type
      const contentType = response.headers.get('content-type') || '';
      let content: string | Uint8Array;

      // Determine how to handle the content based on content type
      if (contentType.includes('application/json')) {
        const jsonData = await response.json();
        content = JSON.stringify(jsonData, null, 2);
      } else if (
        contentType.includes('text/') ||
        contentType.includes('application/javascript') ||
        contentType.includes('application/xml')
      ) {
        content = await response.text();
      } else {
        // Treat as binary data
        const arrayBuffer = await response.arrayBuffer();
        content = new Uint8Array(arrayBuffer);
      }

      // Write to file
      if (typeof content === 'string') {
        fs.writeFileSync(localFilePath, content, 'utf8');
      } else {
        fs.writeFileSync(localFilePath, content);
      }

      // Calculate relative path for tracking processed files
      const localBasePath = path.dirname(path.dirname(localFilePath));
      const relativePath = localFilePath.substring(localBasePath.length);
      filesProcessed.add(relativePath);

      // If we have a last modified date from the server, set the file's mtime to match
      if (remoteLastModified) {
        try {
          fs.utimesSync(localFilePath, remoteLastModified, remoteLastModified);
        } catch (error) {
          console.log(`Failed to set file modification time: ${error}`);
        }
      }

      if (progressCallback) {
        progressCallback('downloaded');
      }

      console.log(`Downloaded file: ${url}`);
      return true;
    } catch (error) {
      console.error(`Error processing file ${url}:`, error);
      return false;
    }
  }

  // Upload a single file from local to remote
  async uploadFile(localFilePath: string): Promise<void> {
    console.log(`Uploading file: ${localFilePath}`);

    // Find which realm this file belongs to
    let realmUrl: string | undefined;
    let relativePath: string | undefined;

    // Normalize the path to use consistent separators
    const normalizedFilePath = path.normalize(localFilePath);

    for (const [url, localPath] of this.realmUrlToLocalPath.entries()) {
      // Normalize the local path as well
      const normalizedLocalPath = path.normalize(localPath);

      // Check if the file path starts with the local path
      if (normalizedFilePath.startsWith(normalizedLocalPath)) {
        realmUrl = url;
        // Calculate the relative path from the local base path
        relativePath = normalizedFilePath.substring(normalizedLocalPath.length);
        // Normalize path separators to forward slashes for the API
        relativePath = relativePath.replace(/\\/g, '/');
        // Remove leading slash if present
        if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
          relativePath = relativePath.substring(1);
        }
        console.log(
          `Found matching realm: ${url} for file: ${normalizedFilePath}`,
        );
        console.log(`Relative path: ${relativePath}`);
        break;
      }
    }

    if (!realmUrl || !relativePath) {
      console.log(`File ${localFilePath} is not part of any synced realm`);

      // Debug logging - list all available realm mappings
      console.log(
        `Available realm mappings (${this.realmUrlToLocalPath.size}):`,
      );
      this.realmUrlToLocalPath.forEach((path, url) => {
        console.log(`  ${url} => ${path}`);
      });

      return;
    }

    let content: string;
    try {
      // Read the file content
      try {
        // Check if the file exists and is readable
        if (!fs.existsSync(localFilePath)) {
          throw new Error(`File ${localFilePath} does not exist`);
        }

        // Check if we have read permissions
        fs.accessSync(localFilePath, fs.constants.R_OK);

        content = fs.readFileSync(localFilePath, 'utf8');
      } catch (fsError) {
        console.error(`Error reading file ${localFilePath}:`, fsError);
        const errorMessage =
          fsError instanceof Error ? fsError.message : String(fsError);
        throw new Error(`Failed to read file: ${errorMessage}`);
      }

      // Construct the API URL
      // remove leading slash if present
      relativePath = relativePath.startsWith('/')
        ? relativePath.substring(1)
        : relativePath;

      const apiUrl = new URL(relativePath, realmUrl).href;

      // Upload the file
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          Authorization: `${await this.realmAuth.getJWT(apiUrl)}`,
          Accept: SupportedMimeType.CardSource,
        },
        body: content,
      });

      if (!response.ok) {
        throw new Error(
          `Failed to upload file: ${response.status} ${response.statusText}`,
        );
      }

      console.log(`Successfully uploaded file: ${localFilePath}`);
    } catch (error: unknown) {
      console.error(`Error uploading file:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to upload file: ${errorMessage}`);
    }
  }

  // Enable file watching for a realm folder
  enableFileWatching(folderPath: string): void {
    // Update metadata first
    this.updateFileWatchingStatus(folderPath, true);

    // If already watching, return
    if (this.fileWatchers.has(folderPath)) {
      return;
    }

    try {
      // Create a file watcher for this folder
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folderPath, '**/*'),
      );

      // Handle file changes
      watcher.onDidChange(async (uri) => {
        if (this.syncInProgress) {
          return; // Skip during sync
        }
        console.log(`File changed: ${uri.fsPath}`);
        await this.uploadFile(uri.fsPath);
      });

      // Handle file creations
      watcher.onDidCreate(async (uri) => {
        if (this.syncInProgress) {
          return; // Skip during sync
        }
        console.log(`File created: ${uri.fsPath}`);
        await this.uploadFile(uri.fsPath);
      });

      // Store the watcher
      this.fileWatchers.set(folderPath, watcher);

      console.log(`File watching enabled for ${folderPath}`);
      vscode.window.showInformationMessage(
        `File watching enabled for realm folder.`,
      );
    } catch (error) {
      console.error('Error enabling file watching:', error);
      vscode.window.showErrorMessage(
        `Error enabling file watching: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Disable file watching for a realm folder
  disableFileWatching(folderPath: string): void {
    // Update metadata first
    this.updateFileWatchingStatus(folderPath, false);

    // Remove and dispose the watcher if it exists
    const watcher = this.fileWatchers.get(folderPath);
    if (watcher) {
      watcher.dispose();
      this.fileWatchers.delete(folderPath);
      console.log(`File watching disabled for ${folderPath}`);
      vscode.window.showInformationMessage(
        `File watching disabled for realm folder.`,
      );
    }
  }

  // Sync a realm from its local path
  async syncRealmFromPath(localPath: string): Promise<void> {
    try {
      // Read the metadata file to get the realm URL and last sync time
      const metadata = this.readRealmMetadata(localPath);
      if (!metadata) {
        throw new Error(
          'No metadata found. Please make sure this is a valid Boxel realm folder.',
        );
      }

      const realmUrl = metadata.realmUrl;
      if (!realmUrl) {
        throw new Error('No realm URL found in metadata.');
      }

      console.log(`Syncing realm from URL: ${realmUrl}`);

      const realmName =
        metadata.realmName || this.extractRealmNameFromUrl(realmUrl);

      // Sync data from remote to local
      await this.syncFromRemote(realmUrl, realmName);
    } catch (error: unknown) {
      console.error(`Error syncing realm from path:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Error syncing realm: ${errorMessage}`);
    }
  }

  // Extract a realm name from a URL
  private extractRealmNameFromUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);

      // Get all path segments that aren't empty
      const pathSegments = parsedUrl.pathname.split('/').filter((p) => p);

      // For boxel.ai URLs, we need to get the realm name which is typically the last segment
      if (parsedUrl.hostname.includes('boxel.ai') && pathSegments.length >= 1) {
        // Get the last segment as the realm name
        return pathSegments[pathSegments.length - 1] || 'unknown-realm';
      }

      // For other URLs, use a fallback approach
      // Try to get a meaningful name from the hostname
      let hostname = parsedUrl.hostname;
      hostname = hostname.replace(/^www\.|^api\.|^realm-/, '');

      // If there's a path, use the last segment as part of the name
      const lastPathSegment = pathSegments[pathSegments.length - 1];

      return lastPathSegment ? `${hostname}-${lastPathSegment}` : hostname;
    } catch (e) {
      // If URL parsing fails, just return a sanitized version of the URL
      return url.replace(/[^a-zA-Z0-9_-]/g, '_');
    }
  }

  // Check if a folder is a valid Boxel realm folder
  isBoxelRealmFolder(folderPath: string): boolean {
    try {
      const metadataPath = path.join(folderPath, '.boxel-realm.json');
      if (!fs.existsSync(metadataPath)) {
        return false;
      }

      // Basic check that the file exists and is valid JSON
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

      // Just check that realmUrl exists - don't filter by user here
      return !!metadata.realmUrl;
    } catch (error) {
      console.error(`Error checking if folder is a realm folder:`, error);
      return false;
    }
  }

  // Check if file watching is enabled for a realm
  isFileWatchingEnabled(folderPath: string): boolean {
    const metadata = this.readRealmMetadata(folderPath);
    return metadata?.fileWatchingEnabled === true;
  }

  // Dispose all file watchers
  dispose(): void {
    for (const watcher of this.fileWatchers.values()) {
      watcher.dispose();
    }
    this.fileWatchers.clear();
  }

  // Update the userId after login
  updateUserId(userId: string | null): void {
    const oldUserId = this.userId;
    this.userId = userId;
    console.log(`LocalFileSystem: Updated user ID to ${userId}`);

    // If we're switching to a new user ID (not just logging out), migrate realms
    if (userId && userId !== oldUserId) {
      this.migrateRealmsToUserFolder();
    }
  }

  // Migrate any existing realms to the new user-specific folder
  private migrateRealmsToUserFolder(): void {
    if (!this.userId) {
      return;
    }

    try {
      console.log(
        '[LocalFileSystem] Checking for realms to migrate to user folder',
      );
      const basePath = this.localStoragePath; // This is the root path without user ID
      const userPath = this.getLocalStoragePath(); // This includes the user ID

      // If they're the same, no migration needed
      if (basePath === userPath) {
        return;
      }

      // Check if there are any realms in the base directory that need to be moved
      if (fs.existsSync(basePath)) {
        const entries = fs.readdirSync(basePath);

        for (const entry of entries) {
          const fullPath = path.join(basePath, entry);

          // Skip directories that are user folders
          if (
            (fs.statSync(fullPath).isDirectory() && entry.startsWith('@')) ||
            entry.includes('_')
          ) {
            continue;
          }

          // Check if this is a realm folder by looking for metadata
          const metadataPath = path.join(fullPath, '.boxel-realm.json');
          if (fs.existsSync(metadataPath)) {
            try {
              const metadata = JSON.parse(
                fs.readFileSync(metadataPath, 'utf8'),
              );

              // Only migrate realms that belong to this user or have no user ID
              if (!metadata.userId || metadata.userId === this.userId) {
                console.log(
                  `[LocalFileSystem] Migrating realm ${entry} to user folder`,
                );

                // Create the destination path
                const destPath = path.join(userPath, entry);

                // If the destination exists, keep the original to avoid data loss
                if (fs.existsSync(destPath)) {
                  console.log(
                    `[LocalFileSystem] Destination already exists, skipping migration for ${entry}`,
                  );
                  continue;
                }

                // Move the directory
                fs.mkdirSync(path.dirname(destPath), { recursive: true });
                fs.renameSync(fullPath, destPath);

                // Update our mapping
                if (metadata.realmUrl) {
                  this.realmUrlToLocalPath.set(metadata.realmUrl, destPath);
                }

                console.log(
                  `[LocalFileSystem] Migrated realm ${entry} to ${destPath}`,
                );
              }
            } catch (error) {
              console.error(
                `[LocalFileSystem] Error checking realm metadata for ${entry}:`,
                error,
              );
            }
          }
        }
      }
    } catch (error) {
      console.error(
        '[LocalFileSystem] Error migrating realms to user folder:',
        error,
      );
    }
  }
}
