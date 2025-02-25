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

  constructor(
    private context: vscode.ExtensionContext,
    private realmAuth: RealmAuth,
  ) {
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
    return this.localStoragePath;
  }

  // Get the local path for a realm
  getLocalPathForRealm(realmUrl: string, realmName: string): string {
    // Create a safe directory name from the realm name
    const safeDirName = realmName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const localPath = path.join(this.localStoragePath, safeDirName);

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
      lastSync: new Date().toISOString(),
      fileWatchingEnabled: false,
    };

    try {
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
      console.log(`Created realm metadata file at ${metadataPath}`);
    } catch (error) {
      console.error(`Error creating metadata file: ${error}`);
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

      // Fetch the file
      const response = await fetch(url, {
        headers: {
          Accept: '*/*',
          Authorization: `${await this.realmAuth.getJWT(url)}`,
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
      console.error(`Error uploading file ${localFilePath}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Error uploading file: ${errorMessage}`);
    }
  }

  // Setup a file watcher for a realm directory
  private setupFileWatcher(realmUrl: string, localPath: string): void {
    // Remove any existing watcher for this realm
    if (this.fileWatchers.has(realmUrl)) {
      this.fileWatchers.get(realmUrl)!.dispose();
    }

    // Create a new file watcher
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(localPath, '**/*'),
      false, // Don't ignore create events
      false, // Don't ignore change events
      false, // Don't ignore delete events
    );

    // Handle file creation and modification
    watcher.onDidCreate((uri) => {
      if (fs.statSync(uri.fsPath).isFile()) {
        this.uploadFile(uri.fsPath);
      }
    });

    watcher.onDidChange((uri) => {
      if (fs.statSync(uri.fsPath).isFile()) {
        this.uploadFile(uri.fsPath);
      }
    });

    // Store the watcher for later disposal
    this.fileWatchers.set(realmUrl, watcher);
  }

  // Enable file watching for a realm
  enableFileWatching(localPath: string): void {
    try {
      const metadata = this.readRealmMetadata(localPath);
      if (!metadata) {
        vscode.window.showErrorMessage(
          "This doesn't appear to be a valid Boxel realm folder.",
        );
        return;
      }

      const realmUrl = metadata.realmUrl;

      // Setup file watcher for this realm
      this.setupFileWatcher(realmUrl, localPath);

      // Update metadata
      this.updateFileWatchingStatus(localPath, true);

      vscode.window.showInformationMessage(
        `File watching enabled for realm "${metadata.realmName}"`,
      );
    } catch (error) {
      console.error('Error enabling file watching:', error);
      vscode.window.showErrorMessage('Failed to enable file watching.');
    }
  }

  // Disable file watching for a realm
  disableFileWatching(localPath: string): void {
    try {
      const metadata = this.readRealmMetadata(localPath);
      if (!metadata) {
        vscode.window.showErrorMessage(
          "This doesn't appear to be a valid Boxel realm folder.",
        );
        return;
      }

      const realmUrl = metadata.realmUrl;

      // Remove file watcher if it exists
      if (this.fileWatchers.has(realmUrl)) {
        this.fileWatchers.get(realmUrl)!.dispose();
        this.fileWatchers.delete(realmUrl);
      }

      // Update metadata
      this.updateFileWatchingStatus(localPath, false);

      vscode.window.showInformationMessage(
        `File watching disabled for realm "${metadata.realmName}"`,
      );
    } catch (error) {
      console.error('Error disabling file watching:', error);
      vscode.window.showErrorMessage('Failed to disable file watching.');
    }
  }

  // Sync a realm from the local path
  async syncRealmFromPath(localPath: string): Promise<void> {
    try {
      const metadata = this.readRealmMetadata(localPath);
      if (!metadata) {
        vscode.window.showErrorMessage(
          "This doesn't appear to be a valid Boxel realm folder.",
        );
        return;
      }

      await this.syncFromRemote(metadata.realmUrl, metadata.realmName);
    } catch (error) {
      console.error('Error syncing realm:', error);
      vscode.window.showErrorMessage('Failed to sync realm.');
    }
  }

  // Dispose all file watchers
  dispose(): void {
    for (const watcher of this.fileWatchers.values()) {
      watcher.dispose();
    }
    this.fileWatchers.clear();
  }

  // Check if a directory is a valid Boxel realm folder
  isBoxelRealmFolder(folderPath: string): boolean {
    console.log('Checking if', folderPath, 'is a Boxel realm folder');
    const metadataPath = path.join(folderPath, '.boxel-realm.json');
    try {
      if (fs.existsSync(metadataPath)) {
        const content = fs.readFileSync(metadataPath, 'utf8');
        const metadata = JSON.parse(content);
        // Basic validation of the metadata
        return !!(metadata.realmUrl && metadata.realmName);
      }
    } catch (error) {
      console.error(`Error checking realm folder: ${error}`);
    }
    return false;
  }

  // Check if file watching is enabled for a realm folder
  isFileWatchingEnabled(folderPath: string): boolean {
    const metadata = this.readRealmMetadata(folderPath);
    return metadata ? !!metadata.fileWatchingEnabled : false;
  }
}
