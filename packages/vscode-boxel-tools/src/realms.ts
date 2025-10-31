import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { RealmAuth } from './realm-auth';
import type { LocalFileSystem } from './local-file-system';

export class RealmItem extends vscode.TreeItem {
  constructor(
    public readonly realmName: string,
    public readonly realmUrl: string,
    public readonly localPath: string,
    public readonly isWatched: boolean,
  ) {
    super(realmName, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${realmName}\n${realmUrl}\nStored at: ${localPath}`;
    this.description = isWatched ? 'Watching' : '';
    this.contextValue = isWatched ? 'realm-watched' : 'realm-unwatched';

    // Add icons
    this.iconPath = new vscode.ThemeIcon(isWatched ? 'eye' : 'eye-closed');
  }
}

export class RealmProvider implements vscode.TreeDataProvider<RealmItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    RealmItem | undefined | null | void
  > = new vscode.EventEmitter<RealmItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    RealmItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor(
    private realmAuth: RealmAuth,
    private localFileSystem: LocalFileSystem,
    private userId: string | null = null,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: RealmItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RealmItem): Promise<RealmItem[]> {
    if (element) {
      return []; // No children for realm items
    }

    // Get all the realm folders
    const rootPath = this.localFileSystem.getLocalStoragePath();
    if (!fs.existsSync(rootPath)) {
      return [];
    }

    const items: RealmItem[] = [];

    // Always show realms, regardless of user login status
    // This ensures the UI always shows something if realms exist

    const entries = fs.readdirSync(rootPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const folderPath = path.join(rootPath, entry.name);
        // Use try/catch to handle potential errors when checking realm folders
        try {
          const metadataPath = path.join(folderPath, '.boxel-realm.json');
          if (fs.existsSync(metadataPath)) {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            if (metadata) {
              // Only filter by userId if we have one and the metadata has one that doesn't match
              if (
                this.userId &&
                metadata.userId &&
                metadata.userId !== this.userId
              ) {
                continue; // Skip realms belonging to other users
              }

              items.push(
                new RealmItem(
                  metadata.realmName,
                  metadata.realmUrl,
                  folderPath,
                  !!metadata.fileWatchingEnabled,
                ),
              );
            }
          }
        } catch (error) {
          console.error(`Error processing realm folder ${folderPath}:`, error);
          // Continue to next folder even if this one had an error
        }
      }
    }

    return items;
  }

  // Update the userId after login
  updateUserId(userId: string | null): void {
    this.userId = userId;
    console.log(`RealmProvider: Updated user ID to ${userId}`);
    this.refresh(); // Refresh the view to show realms for the new user
  }
}
