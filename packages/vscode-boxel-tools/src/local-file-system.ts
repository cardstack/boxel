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

  // Get the current local storage path
  getLocalStoragePath(): string {
    // Simply return the configured storage path without nesting under user ID
    return this.localStoragePath;
  }

  // Get the local path for a realm
  getLocalPathForRealm(realmUrl: string, realmName: string): string {
    // Create a safe directory name from the realm name
    const safeDirName = realmName.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Get the base storage path
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

      // Create or update metadata file
      this.createMetadataFile(localPath, realmUrl, realmName);

      // Process root directory to recursively sync all files
      await this.processRemoteDirectory(
        realmUrl,
        '/',
        localPath,
        filesProcessed,
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
          `Successfully synced realm "${realmName}" to local storage (${filesProcessed.size} files)`,
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
  ): Promise<void> {
    console.log(`Processing remote directory: ${remotePath}`);

    // Ensure path has trailing slash for directory listings
    const apiPath = remotePath.endsWith('/') ? remotePath : `${remotePath}/`;

    // Construct the full API URL
    const apiUrl = `${realmUrl}${apiPath}`;
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

          const entry = info as { meta: { kind: string } };
          const isFile = entry.meta.kind === 'file';
          const entryPath = path.posix.join(remotePath, name);

          if (isFile) {
            // Download the file
            const fileUrl = `${realmUrl}${entryPath}`;
            const localFilePath = path.join(localBasePath, entryPath);
            const success = await this.downloadFile(
              fileUrl,
              localFilePath,
              filesProcessed,
            );
            if (success) {
              console.log(`Downloaded file: ${entryPath}`);
            }
          } else {
            // Process subdirectory
            await this.processRemoteDirectory(
              realmUrl,
              entryPath,
              localBasePath,
              filesProcessed,
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
  }

  // Download a file from a specific URL
  private async downloadFile(
    url: string,
    localFilePath: string,
    filesProcessed: Set<string>,
  ): Promise<boolean> {
    console.log(`Downloading file: ${url}`);

    try {
      // Ensure parent directory exists
      const dirPath = path.dirname(localFilePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // Get the JWT for authentication - use the URL object directly
      const jwt = await this.realmAuth.getJWT(url);

      // Fetch the file
      const response = await fetch(url, {
        headers: {
          Accept: '*/*',
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

      // Update last sync timestamp
      this.updateLastSyncTimestamp(path.dirname(localFilePath));

      return true;
    } catch (error) {
      console.error(`Error downloading file ${url}:`, error);
      return false;
    }
  }

  // Upload a single file from local to remote
  async uploadFile(localFilePath: string): Promise<void> {
    console.log(`Uploading file: ${localFilePath}`);

    // Find which realm this file belongs to
    let realmUrl: string | undefined;
    let relativePath: string | undefined;

    for (const [url, localPath] of this.realmUrlToLocalPath.entries()) {
      if (localFilePath.startsWith(localPath)) {
        realmUrl = url;
        // Calculate the relative path from the local base path
        relativePath = localFilePath.substring(localPath.length);
        // Normalize path separators to forward slashes for the API
        relativePath = relativePath.replace(/\\/g, '/');
        break;
      }
    }

    if (!realmUrl || !relativePath) {
      console.log(`File ${localFilePath} is not part of any synced realm`);
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
      const apiUrl = `${realmUrl}${relativePath}`;

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

      // Get the JWT for authentication
      const jwt = await this.realmAuth.getJWT(realmUrl);

      // Fetch realm info for directory organization
      const realmInfoUrl = new URL('api/realm-info', realmUrl);
      let response = await fetch(realmInfoUrl.toString(), {
        headers: {
          Authorization: jwt,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch realm info: ${response.status} ${response.statusText}`,
        );
      }

      const realmInfo = await response.json();
      console.log('Realm info:', realmInfo);

      // Sync data from remote to local
      await this.syncFromRemote(realmUrl, realmInfo.realmName);
    } catch (error: unknown) {
      console.error(`Error syncing realm from path:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Error syncing realm: ${errorMessage}`);
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
    this.userId = userId;
    console.log(`LocalFileSystem: Updated user ID to ${userId}`);
  }
}
