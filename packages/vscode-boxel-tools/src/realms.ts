import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RealmAuth } from './realm-auth';
import { LocalFileSystem } from './local-file-system';

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
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const folderPath = path.join(rootPath, entry.name);
        if (this.localFileSystem.isBoxelRealmFolder(folderPath)) {
          const metadata = this.localFileSystem.readRealmMetadata(folderPath);
          if (metadata) {
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
      }
    }

    return items;
  }
}
