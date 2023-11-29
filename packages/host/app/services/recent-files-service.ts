import Service from '@ember/service';
import { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';
import { TrackedArray } from 'tracked-built-ins';

import { RealmPaths } from '@cardstack/runtime-common';
import { LocalPath } from '@cardstack/runtime-common/paths';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

type SerialRecentFile = [URL, string];

export interface RecentFile {
  realmURL: URL;
  filePath: LocalPath;
}

export default class RecentFilesService extends Service {
  @service declare operatorModeStateService: OperatorModeStateService;

  @tracked recentFiles = new TrackedArray<RecentFile>([]);

  constructor(properties: object) {
    super(properties);
    this.extractRecentFilesFromStorage();
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

  addRecentFileUrl(url: string) {
    if (!url) {
      return;
    }
    let realmURL = this.operatorModeStateService.resolvedRealmURL;

    if (realmURL) {
      let realmPaths = new RealmPaths(new URL(realmURL));
      if (realmPaths.inRealm(new URL(url))) {
        this.addRecentFile(realmPaths.local(url));
      }
    }
  }

  addRecentFile(file: LocalPath) {
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
