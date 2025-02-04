/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { SupportedMimeType } from '@cardstack/runtime-common/router';
import { RealmInfo } from '@cardstack/runtime-common/realm';

import { RealmAuth } from './realm-auth';
import { SkillsProvider } from './skills';

export class File implements vscode.FileStat {
  type: vscode.FileType;
  ctime: number;
  mtime: number;
  size: number;

  name: string;
  data?: Uint8Array;

  constructor(name: string) {
    this.type = vscode.FileType.File;
    this.ctime = Date.now();
    this.mtime = Date.now();
    this.size = 0;
    this.name = name;
  }
}

export class Directory implements vscode.FileStat {
  type: vscode.FileType;
  ctime: number;
  mtime: number;
  size: number;

  name: string;
  entries: Map<string, File | Directory>;

  constructor(name: string) {
    this.type = vscode.FileType.Directory;
    this.ctime = Date.now();
    this.mtime = Date.now();
    this.size = 0;
    this.name = name;
    this.entries = new Map();
  }
}

export type Entry = File | Directory;

const selectedRealmKey = 'selectedRealms';
export class RealmFS implements vscode.FileSystemProvider {
  root = new Directory('');

  private context: vscode.ExtensionContext;
  private selectedRealms: Set<string> = new Set();
  private realmDirNamePromises: Map<string, Promise<string>> = new Map();
  private realmDirNameToUrl: Map<string, string> = new Map();

  constructor(
    context: vscode.ExtensionContext,
    private realmAuth: RealmAuth,
    private skillsProvider: SkillsProvider,
  ) {
    this.context = context;
    this.realmAuth = realmAuth;
    this.skillsProvider = skillsProvider;

    let selectedRealms = this.context.globalState.get<string>(selectedRealmKey);
    if (selectedRealms && typeof selectedRealms === 'string') {
      this.selectedRealms = new Set(selectedRealms.split(','));
    } else {
      this.selectedRealms = new Set();
    }
  }

  addSelectedRealms(realmURL: string) {
    this.selectedRealms.add(realmURL);
    // Using globalState because workspaceState will be reset when the extension is reactivated.
    this.context.globalState.update(
      selectedRealmKey,
      Array.from(this.selectedRealms).join(','),
    );
  }

  deleteSelectedRealms(realmURL: string) {
    this.selectedRealms.delete(realmURL);
    this.context.globalState.update(selectedRealmKey, undefined);
  }

  resetSelectedRealms() {
    this.selectedRealms = new Set();
    this.context.globalState.update(selectedRealmKey, undefined);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    console.log('Statting:', uri);
    const entry = await this._lookup(uri);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return entry;
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    console.log('Reading directory:', uri);
    try {
      const directory = await this._fetchDirectoryEntry(uri);
      return Array.from(directory.entries.entries()).map(([name, entry]) => [
        name,
        entry.type,
      ]);
    } catch (error) {
      console.error('Error reading directory:', error);
      throw vscode.FileSystemError.Unavailable(uri);
    }
  }

  // --- manage file contents

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    console.log('Reading file:', uri);
    const data = (await this._lookupAsFile(uri)).data;
    if (data) {
      console.log('File data:', data);
      return data;
    }
    console.log('File not found:', uri);
    throw vscode.FileSystemError.FileNotFound();
  }

  async readRawTextFile(
    uri: vscode.Uri,
  ): Promise<{ success: boolean; body: string }> {
    console.log('Fetching raw file:', uri);
    let apiUrl = this._getUrl(uri);
    console.log('API URL:', apiUrl);
    const headers = {
      Authorization: `${await this.realmAuth.getJWT(apiUrl)}`,
    };

    const response = await fetch(apiUrl, { headers });
    return {
      success: response.ok,
      body: await response.text(),
    };
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    console.log('Writing file:', uri);

    let requestType = 'POST';
    let apiUrl = this._getUrl(uri);

    let headers: Record<string, string> = {
      'Content-Type': 'text/plain;charset=UTF-8',
      Authorization: `${await this.realmAuth.getJWT(apiUrl)}`,
      Accept: SupportedMimeType.CardSource,
    };

    try {
      // Convert Uint8Array to text
      const contentText = new TextDecoder().decode(content);
      console.log('Content text:', contentText);
      let response = await fetch(apiUrl, {
        method: requestType,
        headers: headers,
        body: contentText,
      });

      if (!response.ok) {
        console.error(
          'Error writing file:',
          response.status,
          response.statusText,
        );
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
    } catch (error) {
      console.error('Error writing file:', error);
      throw vscode.FileSystemError.Unavailable(uri);
    }
  }

  // --- manage files/folders

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean },
  ): Promise<void> {
    const entry = await this._lookup(oldUri);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(oldUri);
    }

    if (!options.overwrite && (await this._lookup(newUri))) {
      throw vscode.FileSystemError.FileExists(newUri);
    }

    const oldParent = await this._lookupParentDirectory(oldUri);
    const newParent = await this._lookupParentDirectory(newUri);
    const newName = path.posix.basename(newUri.path);

    oldParent.entries.delete(entry.name);
    entry.name = newName;
    newParent.entries.set(newName, entry);

    this._fireSoon(
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri },
    );
  }

  async delete(uri: vscode.Uri): Promise<void> {
    const dirname = uri.with({ path: path.posix.dirname(uri.path) });
    const basename = path.posix.basename(uri.path);
    if (this.realmDirNameToUrl.has(basename)) {
      this.deleteSelectedRealms(this.realmDirNameToUrl.get(basename)!);
    }

    const parent = await this._lookupAsDirectory(dirname);
    if (!parent.entries.has(basename)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    parent.entries.delete(basename);
    parent.mtime = Date.now();
    parent.size -= 1;
    this._fireSoon(
      { type: vscode.FileChangeType.Changed, uri: dirname },
      { uri, type: vscode.FileChangeType.Deleted },
    );
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const basename = path.posix.basename(uri.path);
    const dirname = uri.with({ path: path.posix.dirname(uri.path) });
    const parent = await this._lookupAsDirectory(dirname);

    const entry = new Directory(basename);
    parent.entries.set(entry.name, entry);
    parent.mtime = Date.now();
    parent.size += 1;
    this._fireSoon(
      { type: vscode.FileChangeType.Changed, uri: dirname },
      { type: vscode.FileChangeType.Created, uri },
    );
  }

  // --- lookup

  private async _lookup(uri: vscode.Uri): Promise<Entry | undefined> {
    const parts = uri.path.split('/').filter((part) => part.length > 0);
    if (parts.length == 0 || !parts[parts.length - 1].includes('.')) {
      return await this._fetchDirectoryEntry(uri);
    }
    // ok we know it's a file.
    // we need to fetch the file from the api
    return await this._fetchFileEntry(uri);
  }

  private async _fetchDirectoryEntry(uri: vscode.Uri): Promise<Directory> {
    console.log('Fetching directory entry:', uri);
    if (this._isRootDirectory(uri)) {
      return await this._fetchRootDirectoryEntry(uri);
    }

    let apiUrl = this._getUrl(uri);
    // We can only get the directory contents if we have a trailing slash
    if (!apiUrl.endsWith('/')) {
      apiUrl += '/';
    }
    console.log('API URL:', apiUrl);
    try {
      const response = await fetch(apiUrl, {
        headers: {
          Accept: 'application/vnd.api+json',
          Authorization: `${await this.realmAuth.getJWT(apiUrl)}`,
        },
      });
      console.log('Response!');

      if (!response.ok) {
        console.log('Response not ok:', response.status);
        throw vscode.FileSystemError.FileNotFound(uri);
      }

      const data: any = await response.json();
      console.log('Response data:', data);
      const directory = new Directory(path.basename(uri.path));

      for (const [name, info] of Object.entries(data.data.relationships)) {
        const fileType =
          (info as { meta: { kind: string } }).meta.kind === 'file'
            ? vscode.FileType.File
            : vscode.FileType.Directory;
        if (fileType === vscode.FileType.File) {
          directory.entries.set(name, new File(name));
        } else {
          directory.entries.set(name, new Directory(name));
        }
      }

      return directory;
    } catch (error) {
      console.error('Error fetching directory:', error);
      throw vscode.FileSystemError.Unavailable(uri);
    }
  }

  private async _fetchCursorRules(): Promise<File> {
    const file = new File('.cursorrules');
    // here we're just going to go through the already cached skills
    // we're not re-reading them each time
    let combinedText = '';
    for (const skill of this.skillsProvider.getSelectedSkills()) {
      combinedText += `${skill.instructions}\n`;
    }
    file.data = new TextEncoder().encode(combinedText);
    file.mtime = Date.now();
    file.size = file.data.byteLength;
    return file;
  }
  private async _fetchRootDirectoryEntry(uri: vscode.Uri) {
    for (const selectedRealmURL of this.selectedRealms) {
      let realmDirName = await this.getRealmDirName(selectedRealmURL);
      console.log('Realm directory name:', realmDirName);

      let realmDirUri = uri.toString() + realmDirName;
      let realmDir = await this._fetchDirectoryEntry(
        vscode.Uri.parse(realmDirUri),
      );
      this.root.entries.set(realmDirName, realmDir);
    }

    return this.root;
  }

  private async _fetchFileEntry(uri: vscode.Uri): Promise<File> {
    // special case for .cursorrules
    // we construct is specially
    if (path.basename(uri.path) === '.cursorrules') {
      return this._fetchCursorRules();
    }
    console.log('Fetching file entry:', uri);
    // We don't expect any files in root directory
    if (this._isFileInRootDirectory(uri)) {
      throw vscode.FileSystemError.Unavailable(uri);
    }
    let apiUrl = this._getUrl(uri);
    console.log('API URL:', apiUrl);

    try {
      let headers = {
        Accept: SupportedMimeType.CardSource,
        Authorization: `${await this.realmAuth.getJWT(apiUrl)}`,
      };

      console.log('Headers:', headers);

      const response = await fetch(apiUrl, { headers });

      if (!response.ok) {
        console.log('Response not ok:', response.status);
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      console.log('Response:', response);

      let content = new Uint8Array(await response.arrayBuffer());

      const file = new File(path.basename(uri.path));
      file.data = content;
      file.mtime = Date.now();
      file.size = content.byteLength;
      console.log('File:', file);
      return file;
    } catch (error) {
      console.error('Error fetching file:', error);
      throw vscode.FileSystemError.Unavailable(uri);
    }
  }

  private async _lookupAsDirectory(uri: vscode.Uri): Promise<Directory> {
    const entry = await this._lookup(uri);
    if (entry instanceof Directory) {
      return entry;
    }
    throw vscode.FileSystemError.FileNotADirectory(uri);
  }

  private async _lookupAsFile(uri: vscode.Uri): Promise<File> {
    const entry = await this._lookup(uri);
    if (entry instanceof File) {
      return entry;
    }
    throw vscode.FileSystemError.FileIsADirectory(uri);
  }

  private async _lookupParentDirectory(uri: vscode.Uri): Promise<Directory> {
    const dirname = uri.with({ path: path.posix.dirname(uri.path) });
    return await this._lookupAsDirectory(dirname);
  }

  // Realm directory name format:
  // [REALM NAME] ([REALM PATH join with '-'])
  // Example: My Workspace (fadhlan-workspace1)
  getRealmDirName(realmURL: string) {
    if (!this.realmDirNamePromises.has(realmURL)) {
      let promise = (async () => {
        let realmName = await this._getRealmName(realmURL);
        let realmPathNameParts = new URL(realmURL).pathname
          .split('/')
          .filter((part) => part.length > 0);
        let realmDirName = `${realmName} (${realmPathNameParts.join('-')})`;
        this.realmDirNameToUrl.set(realmDirName, realmURL);
        return realmDirName;
      })();
      this.realmDirNamePromises.set(realmURL, promise);
    }
    return this.realmDirNamePromises.get(realmURL)!;
  }

  private async _getRealmName(realmUrl: string) {
    console.log('Getting realm name for', realmUrl);

    let response = await fetch(`${realmUrl}_info`, {
      headers: {
        Accept: SupportedMimeType.RealmInfo,
        Authorization: `${await this.realmAuth.getJWT(realmUrl)}`,
      },
    });

    if (!response.ok) {
      console.log('response not ok when fetching realm info');
      return 'Unknown Workspace';
    }

    let realmInfo = (await response.json())?.data?.attributes as RealmInfo;
    return realmInfo.name;
  }

  private _getUrl(uri: vscode.Uri) {
    let realmDirName = Array.from(this.realmDirNameToUrl.keys()).find(
      (realmDirName) => uri.path.includes(realmDirName),
    );
    if (!realmDirName) {
      throw vscode.FileSystemError.Unavailable(uri);
    }
    let realmUrl = this.realmDirNameToUrl.get(realmDirName);
    if (!realmUrl) {
      throw vscode.FileSystemError.Unavailable(uri);
    }
    return `${realmUrl}${uri.path.substring(realmDirName.length + 2).trim()}`;
  }

  private _isRootDirectory(uri: vscode.Uri): boolean {
    return (
      uri.authority === 'boxel-workspaces' &&
      (uri.path === '' || uri.path === '/')
    );
  }

  private _isFileInRootDirectory(uri: vscode.Uri): boolean {
    let parts = uri.path.split('/').filter((part) => part.length > 0);
    return parts[0].includes('.') && uri.authority === 'boxel-workspaces';
  }

  // --- manage file events

  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private _bufferedEvents: vscode.FileChangeEvent[] = [];
  private _fireSoonHandle?: NodeJS.Timeout;

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  watch(_resource: vscode.Uri): vscode.Disposable {
    // ignore, fires for all changes...
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return new vscode.Disposable(() => {});
  }

  private _fireSoon(...events: vscode.FileChangeEvent[]): void {
    this._bufferedEvents.push(...events);

    if (this._fireSoonHandle) {
      clearTimeout(this._fireSoonHandle);
    }

    this._fireSoonHandle = setTimeout(() => {
      this._emitter.fire(this._bufferedEvents);
      this._bufferedEvents.length = 0;
    }, 5);
  }
}
