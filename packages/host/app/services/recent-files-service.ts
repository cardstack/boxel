import type Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';
import { TrackedArray } from 'tracked-built-ins';

import { RealmPaths } from '@cardstack/runtime-common';
import { LocalPath } from '@cardstack/runtime-common/paths';

import RealmService from './realm';

import type OperatorModeStateService from './operator-mode-state-service';
import type ResetService from './reset';

type SerialRecentFile = [URL, string, CursorPosition];

export type CursorPosition = {
  line: number;
  column: number;
};
export interface RecentFile {
  realmURL: URL;
  filePath: LocalPath;
  cursorPosition?: CursorPosition;
}

export default class RecentFilesService extends Service {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private reset: ResetService;
  @service declare private realm: RealmService;

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

  removeRecentFile(url: URL) {
    let index = this.findRecentFileIndex(url);

    if (index === -1) {
      return;
    }

    while (index !== -1) {
      this.recentFiles.splice(index, 1);
      index = this.findRecentFileIndex(url);
    }

    this.persistRecentFiles();
  }

  addRecentFile(url: URL) {
    let realmURL = this.realm.realmOfURL(url);
    if (!realmURL) {
      return;
    }

    let realmPaths = new RealmPaths(realmURL);

    if (!realmPaths.inRealm(url)) {
      return;
    }

    const existingIndex = this.findRecentFileIndex(url);

    let cursorPosition;
    if (existingIndex > -1) {
      if (!cursorPosition) {
        cursorPosition = this.recentFiles[existingIndex].cursorPosition;
      }
      this.recentFiles.splice(existingIndex, 1);
    }

    this.recentFiles.unshift({
      realmURL,
      filePath: realmPaths.local(url),
      cursorPosition,
    });

    if (this.recentFiles.length > 100) {
      this.recentFiles.pop();
    }

    this.persistRecentFiles();
  }

  findRecentFile(url: URL) {
    const existingIndex = this.findRecentFileIndex(url);
    return existingIndex > -1 ? this.recentFiles[existingIndex] : undefined;
  }

  updateCursorPositionByURL(url: URL, cursorPosition?: CursorPosition) {
    const existingIndex = this.findRecentFileIndex(url);
    if (existingIndex > -1) {
      this.recentFiles[existingIndex].cursorPosition = cursorPosition;
      this.persistRecentFiles();
    }
  }

  private persistRecentFiles() {
    window.localStorage.setItem(
      'recent-files',
      JSON.stringify(
        this.recentFiles.map((recentFile) => [
          recentFile.realmURL.toString(),
          recentFile.filePath,
          recentFile.cursorPosition,
        ]),
      ),
    );
  }

  private findRecentFileIndex(url: URL) {
    return this.recentFiles.findIndex(
      ({ realmURL, filePath }) => `${realmURL}${filePath}` === url.href,
    );
  }

  private extractRecentFilesFromStorage() {
    let recentFilesString = window.localStorage.getItem('recent-files');

    if (recentFilesString) {
      try {
        this.recentFiles = new TrackedArray(
          JSON.parse(recentFilesString).reduce(function (
            recentFiles: RecentFile[],
            [realmUrl, filePath, cursorPosition]: SerialRecentFile,
          ) {
            try {
              let url = new URL(realmUrl);
              recentFiles.push({ realmURL: url, filePath, cursorPosition });
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
