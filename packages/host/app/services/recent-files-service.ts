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

    if (existingIndex > -1) {
      this.recentFiles.splice(existingIndex, 1);
    }

    this.recentFiles.unshift({
      realmURL: new URL(currentRealmUrl),
      filePath: file,
    });

    if (this.recentFiles.length > 100) {
      this.recentFiles.pop();
    }

    this.persistRecentFiles();
  }

  private persistRecentFiles() {
    window.localStorage.setItem(
      'recent-files',
      JSON.stringify(
        this.recentFiles.map((recentFile) => [
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

    return this.recentFiles.findIndex(
      ({ realmURL, filePath }) =>
        realmURL.href === currentRealmUrl.href && filePath === path,
    );
  }

  private extractRecentFilesFromStorage() {
    let recentFilesString = window.localStorage.getItem('recent-files');

    if (recentFilesString) {
      try {
        this.recentFiles = new TrackedArray(
          JSON.parse(recentFilesString).reduce(function (
            recentFiles: RecentFile[],
            [realmUrl, filePath]: SerialRecentFile,
          ) {
            try {
              let url = new URL(realmUrl);
              recentFiles.push({ realmURL: url, filePath });
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
