import type Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';
import { TrackedArray } from 'tracked-built-ins';

import { RealmPaths } from '@cardstack/runtime-common';
import { LocalPath } from '@cardstack/runtime-common/paths';

import type OperatorModeStateService from './operator-mode-state-service';
import type ResetService from './reset';

type SerialRecentFile = [URL, string];

export interface RecentFile {
  realmURL: URL;
  filePath: LocalPath;
}

export default class RecentFilesService extends Service {
  // we shouldn't be making assumptions about what realm the files are coming
  // from, the caller should just tell us
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare reset: ResetService;

  @tracked private declare _recentFiles: TrackedArray<RecentFile>;

  constructor(owner: Owner) {
    super(owner);
    this.resetState();
    this.reset.register(this);
    this.extractRecentFilesFromStorage();
  }

  get recentFiles() {
    return this._recentFiles.filter(
      (file) =>
        file.realmURL.href === this.operatorModeStateService.realmURL.href,
    );
  }

  resetState() {
    this._recentFiles = new TrackedArray([]);
  }

  removeRecentFile(file: LocalPath) {
    let index = this.findRecentFileIndex(file);

    if (index === -1) {
      return;
    }

    while (index !== -1) {
      this._recentFiles.splice(index, 1);
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

    if (existingIndex > -1) {
      this._recentFiles.splice(existingIndex, 1);
    }

    this._recentFiles.unshift({
      realmURL: new URL(currentRealmUrl),
      filePath: file,
    });

    if (this._recentFiles.length > 100) {
      this._recentFiles.pop();
    }

    this.persistRecentFiles();
  }

  private persistRecentFiles() {
    window.localStorage.setItem(
      'recent-files',
      JSON.stringify(
        this._recentFiles.map((recentFile) => [
          recentFile.realmURL.toString(),
          recentFile.filePath,
        ]),
      ),
    );
  }

  private findRecentFileIndex(path: LocalPath) {
    // TODO this wont work when visiting files that come from multiple realms in
    // code mode...
    let currentRealmUrl = this.operatorModeStateService.realmURL;

    return this._recentFiles.findIndex(
      ({ realmURL, filePath }) =>
        realmURL.href === currentRealmUrl.href && filePath === path,
    );
  }

  private extractRecentFilesFromStorage() {
    let _recentFilesString = window.localStorage.getItem('recent-files');

    if (_recentFilesString) {
      try {
        this._recentFiles = new TrackedArray(
          JSON.parse(_recentFilesString).reduce(function (
            _recentFiles: RecentFile[],
            [realmUrl, filePath]: SerialRecentFile,
          ) {
            try {
              let url = new URL(realmUrl);
              _recentFiles.push({ realmURL: url, filePath });
            } catch (e) {
              console.log(
                `Ignoring non-URL recent file from storage: ${realmUrl}`,
              );
            }
            return _recentFiles;
          }, []),
        );
      } catch (e) {
        console.log('Error restoring recent files', e);
      }
    }
  }
}
