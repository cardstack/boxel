/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import {
  RealmAuthClient,
  RealmAuthMatrixClientInterface,
} from '@cardstack/runtime-common/realm-auth-client';
import { SecretStorage } from "vscode";
import { createClient } from "matrix-js-sdk";

function getUrl(uri: vscode.Uri) {
  let scheme = uri.scheme.split("+")[1];
  let auth = uri.authority;
  let path = uri.path;
  return `${scheme}://${auth}${path}`;
}

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

export class RealmFS implements vscode.FileSystemProvider {
  root = new Directory("");
  realmClients: Map<string, RealmAuthClient> = new Map();
  realmsInitialized = false;
  jwtPromises: Map<string, Promise<string>> = new Map();
  secrets: SecretStorage;

  async getRealmUrls() {
    if (!this.realmsInitialized) {
      console.log("No realm clients, setting up realms");
      await this.setupRealms();
    }
    console.log("Realm clients", this.realmClients, this.realmClients.keys());
    return Array.from(this.realmClients.keys());
  }

  async getJwtAndDeletePromise(url: string) {
    let jwt = await this.jwtPromises.get(url);
    this.jwtPromises.delete(url);
    return jwt;
  }

  async setupRealms() {
    const session = await vscode.authentication.getSession("synapse", [], {
      createIfNone: true,
    });
    const serverUrl = vscode.workspace
      .getConfiguration("boxelrealm")
      .get("matrixServer") as string;
    if (!serverUrl) {
      throw new Error("No matrix server url found, please check your settings");
    }
    console.log("Session:", session);
    const decodedAuth = JSON.parse(session.accessToken);
    const matrixClient = createClient({
      baseUrl: serverUrl,
      accessToken: decodedAuth.access_token,
      userId: decodedAuth.user_id,
      deviceId: decodedAuth.device_id,
    });
    let realmsEventData =
      (await matrixClient.getAccountDataFromServer(
        "com.cardstack.boxel.realms"
      )) || {};
    console.log("Realms event data:", realmsEventData, typeof realmsEventData);
    let realms = realmsEventData.realms || [];
    console.log("Realms:", realms);
    vscode.window.showInformationMessage(
      `Boxel - found ${realms.length} realms`
    );
    for (const realm of realms) {
      console.log("new realm:", realm);
      let newRealmClient = new RealmAuthClient(new URL(realm), matrixClient);
      console.log("newRealmClient", newRealmClient);
      this.realmClients.set(realm, newRealmClient);
      console.log("Realm client set", realm);
    }
    console.log("Realm clients setup", this.realmClients);
    this.realmsInitialized = true;
  }

  async getJWT(url: string) {
    console.log("Getting JWT for ", url);
    if (!this.realmsInitialized) {
      await this.setupRealms();
    }
    // Find the realm client that prefixes the url
    for (const [realmUrl, realmClient] of this.realmClients.entries()) {
      if (url.startsWith(realmUrl.toString())) {
        console.log(
          "Found realm client for",
          url,
          "it's the one for",
          realmUrl
        );
        console.log("Checking if we're currently loading one");

        if (this.jwtPromises.has(realmUrl.toString())) {
          console.log("We're already loading one, waiting");
          return this.getJwtAndDeletePromise(realmUrl.toString());
        } else {
          console.log("We're not currently loading one, creating");
          const promise = realmClient.getJWT();
          this.jwtPromises.set(realmUrl.toString(), promise);
          return promise;
        }
      }
    }
    throw new Error("No realm client found for " + url);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const entry = await this._lookup(uri);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return entry;
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    console.log("Reading directory:", uri);
    try {
      const directory = await this._fetchDirectoryEntry(uri);
      return Array.from(directory.entries.entries()).map(([name, entry]) => [
        name,
        entry.type,
      ]);
    } catch (error) {
      console.error("Error reading directory:", error);
      throw vscode.FileSystemError.Unavailable(uri);
    }
  }

  // --- manage file contents

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    console.log("Reading file:", uri);
    const data = (await this._lookupAsFile(uri)).data;
    if (data) {
      console.log("File data:", data);
      return data;
    }
    console.log("File not found:", uri);
    throw vscode.FileSystemError.FileNotFound();
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    console.log("Writing file:", uri);

    let requestType: string = "POST";
    let apiUrl = getUrl(uri);

    let headers: Record<string, string> = {
      "Content-Type": "text/plain;charset=UTF-8",
      Authorization: `${await this.getJWT(apiUrl)}`,
    };

    // Add special header for .gts files
    if (uri.path.endsWith(".gts")) {
      headers["Accept"] = "application/vnd.card+source";
      requestType = "POST";
    } else if (uri.path.endsWith(".json")) {
      // We cannot write new files so this only works for editing existing ones
      requestType = "PATCH";
      apiUrl = apiUrl.replace(".json", "");
      console.log("API URL:", apiUrl, "requestType:", requestType);
      headers["Accept"] = "application/vnd.card+json";
    }

    try {
      // Convert Uint8Array to text
      const contentText = new TextDecoder().decode(content);
      console.log("Content text:", contentText);
      let response = await fetch(apiUrl, {
        method: requestType,
        headers: headers,
        body: contentText,
      });

      if (!response.ok) {
        console.error(
          "Error writing file:",
          response.status,
          response.statusText
        );
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
    } catch (error) {
      console.error("Error writing file:", error);
      throw vscode.FileSystemError.Unavailable(uri);
    }
  }

  // --- manage files/folders

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
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
      { type: vscode.FileChangeType.Created, uri: newUri }
    );
  }

  async delete(uri: vscode.Uri): Promise<void> {
    const dirname = uri.with({ path: path.posix.dirname(uri.path) });
    const basename = path.posix.basename(uri.path);
    const parent = await this._lookupAsDirectory(dirname);
    if (!parent.entries.has(basename)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    parent.entries.delete(basename);
    parent.mtime = Date.now();
    parent.size -= 1;
    this._fireSoon(
      { type: vscode.FileChangeType.Changed, uri: dirname },
      { uri, type: vscode.FileChangeType.Deleted }
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
      { type: vscode.FileChangeType.Created, uri }
    );
  }

  // --- lookup

  private async _lookup(uri: vscode.Uri): Promise<Entry | undefined> {
    const parts = uri.path.split("/").filter((part) => part.length > 0);
    if (!parts[parts.length - 1].includes(".")) {
      return await this._fetchDirectoryEntry(uri);
    }
    // ok we know it's a file.
    // we need to fetch the file from the api
    return await this._fetchFileEntry(uri);
  }

  private async _fetchDirectoryEntry(uri: vscode.Uri): Promise<Directory> {
    console.log("Fetching directory entry:", uri);

    let apiUrl = getUrl(uri);
    // We can only get the directory contents if we have a trailing slash
    if (!apiUrl.endsWith("/")) {
      apiUrl += "/";
    }
    console.log("API URL:", apiUrl);
    try {
      const response = await fetch(apiUrl, {
        headers: {
          Accept: "application/vnd.api+json",
          Authorization: `${await this.getJWT(apiUrl)}`,
        },
      });
      console.log("Response!");

      if (!response.ok) {
        console.log("Response not ok:", response.status);
        throw vscode.FileSystemError.FileNotFound(uri);
      }

      const data: any = await response.json();
      console.log("Response data:", data);
      const directory = new Directory(path.basename(uri.path));

      for (const [name, info] of Object.entries(data.data.relationships)) {
        const fileType =
          (info as { meta: { kind: string } }).meta.kind === "file"
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
      console.error("Error fetching directory:", error);
      throw vscode.FileSystemError.Unavailable(uri);
    }
  }

  private async _fetchFileEntry(uri: vscode.Uri): Promise<File> {
    console.log("Fetching file entry:", uri);
    let apiUrl = getUrl(uri);
    console.log("API URL:", apiUrl);

    try {
      let headers = {
        Accept: "application/vnd.api+json",
        Authorization: `${await this.getJWT(apiUrl)}`,
      };

      // Add special header for .gts files
      if (uri.path.endsWith(".gts")) {
        headers["Accept"] = "application/vnd.card+source";
      } else if (uri.path.endsWith(".json")) {
        headers["Accept"] = "application/vnd.card+json";
      }

      console.log("Headers:", headers);

      const response = await fetch(apiUrl, { headers });

      if (!response.ok) {
        console.log("Response not ok:", response.status);
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      console.log("Response:", response);

      const contentType = response.headers.get("Content-Type");
      let content: Uint8Array;

      if (contentType && contentType.includes("application/json")) {
        const jsonData = await response.json();
        content = new TextEncoder().encode(JSON.stringify(jsonData, null, 2));
      } else {
        content = new Uint8Array(await response.arrayBuffer());
      }

      const file = new File(path.basename(uri.path));
      file.data = content;
      file.mtime = Date.now();
      file.size = content.byteLength;
      console.log("File:", file);
      return file;
    } catch (error) {
      console.error("Error fetching file:", error);
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

  // --- manage file events

  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private _bufferedEvents: vscode.FileChangeEvent[] = [];
  private _fireSoonHandle?: NodeJS.Timeout;

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  watch(_resource: vscode.Uri): vscode.Disposable {
    // ignore, fires for all changes...
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
