import type Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';
import { TrackedArray } from 'tracked-built-ins';

import { RealmPaths } from '@cardstack/runtime-common';
import type { LocalPath } from '@cardstack/runtime-common/paths';

import { RecentFiles } from '../utils/local-storage-keys';

import type OperatorModeStateService from './operator-mode-state-service';
import type ResetService from './reset';

type SerialRecentFile = [URL, string, CursorPosition, number];

export type CursorPosition = {
  line: number;
  column: number;
};
export interface RecentFile {
  realmURL: URL;
  filePath: LocalPath;
  cursorPosition: CursorPosition | null;
  timestamp?: number;
}

export default class RecentFilesService extends Service {
  // we shouldn't be making assumptions about what realm the files are coming
  // from, the caller should just tell us
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private reset: ResetService;

  @tracked declare recentFiles: TrackedArray<RecentFile>;

  constructor(owner: Owner) {
    super(owner);
    this.resetState();
    this.reset.register(this);
    this.extractRecentFilesFromStorage();
  }

  resetState() {
    this.recentFiles = new TrackedArray([]);
  }

  removeRecentFile(file: LocalPath) {
    let index = this.findRecentFileIndex(file);

    if (index === -1) {
      return;
    }

    while (index !== -1) {
      this.recentFiles.splice(index, 1);
      index = this.findRecentFileIndex(file);
    }

    this.persistRecentFiles();
  }

  addRecentFileUrl(urlString: string) {
    if (!urlString) {
      return;
    }
    // TODO this wont work when visiting files that come from multiple realms in
    // code mode...
    let realmURL = this.operatorModeStateService.realmURL;

    if (realmURL) {
      let realmPaths = new RealmPaths(new URL(realmURL));
      let url = new URL(urlString);

      if (realmPaths.inRealm(url)) {
        this.addRecentFile(realmPaths.local(url));
      }
    }
  }

  addRecentFile(file: LocalPath) {
    // TODO this wont work when visiting files that come from multiple realms in
    // code mode...
    let currentRealmUrl = this.operatorModeStateService.realmURL;

    if (!currentRealmUrl) {
      return;
    }

    const existingIndex = this.findRecentFileIndex(file);

    let cursorPosition;
    if (existingIndex > -1) {
      if (!cursorPosition) {
        cursorPosition = this.recentFiles[existingIndex].cursorPosition;
      }
      this.recentFiles.splice(existingIndex, 1);
    }

    this.recentFiles.unshift({
      realmURL: new URL(currentRealmUrl),
      filePath: file,
      cursorPosition: cursorPosition ?? null,
      timestamp: Date.now(),
    });

    if (this.recentFiles.length > 100) {
      this.recentFiles.pop();
    }

    this.persistRecentFiles();
  }

  findRecentFileByURL(urlString: string) {
    const existingIndex = this.findRecentFileIndexByURL(urlString);
    return existingIndex > -1 ? this.recentFiles[existingIndex] : undefined;
  }

  findRecentFileByRealmURL(url: string) {
    return this.recentFiles.find((recentFile) => {
      const realmUrl = new RealmPaths(new URL(url)).url;
      return realmUrl === recentFile.realmURL.href;
    });
  }

  updateCursorPositionByURL(
    urlString: string,
    cursorPosition?: CursorPosition,
  ) {
    const existingIndex = this.findRecentFileIndexByURL(urlString);
    if (existingIndex > -1) {
      this.recentFiles[existingIndex].cursorPosition = cursorPosition ?? null;
      this.recentFiles[existingIndex].timestamp = Date.now();
      this.persistRecentFiles();
    }
  }

  private persistRecentFiles() {
    window.localStorage.setItem(
      RecentFiles,
      JSON.stringify(
        this.recentFiles.map((recentFile) => [
          recentFile.realmURL.toString(),
          recentFile.filePath,
          recentFile.cursorPosition,
          recentFile.timestamp,
        ]),
      ),
    );
  }

  private findRecentFileIndex(path: LocalPath) {
    // TODO this wont work when visiting files that come from multiple realms in
    // code mode...
    let currentRealmUrl = this.operatorModeStateService.realmURL;

    return this.recentFiles.findIndex(
      ({ realmURL, filePath }) =>
        realmURL.href === currentRealmUrl && filePath === path,
    );
  }

  private findRecentFileIndexByURL(urlString: string) {
    return this.recentFiles.findIndex(
      ({ realmURL, filePath }) => `${realmURL}${filePath}` === urlString,
    );
  }

  private extractRecentFilesFromStorage() {
    let recentFilesString = window.localStorage.getItem(RecentFiles);

    if (recentFilesString) {
      try {
        this.recentFiles = new TrackedArray(
          JSON.parse(recentFilesString).reduce(function (
            recentFiles: RecentFile[],
            [realmUrl, filePath, cursorPosition, timestamp]: SerialRecentFile,
          ) {
            try {
              let url = new URL(realmUrl);
              recentFiles.push({
                realmURL: url,
                filePath,
                cursorPosition,
                timestamp,
              });
            } catch (e) {
              console.log(
                `Ignoring non-URL recent file from storage: ${realmUrl}`,
              );
            }
            return recentFiles;
          }, []),
        );
      } catch (e) {
        console.log('Error restoring recent files', e);
      }
    }
  }
}

declare module '@ember/service' {
  interface Registry {
    'recent-files-service': RecentFilesService;
  }
}
