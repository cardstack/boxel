import Service from '@ember/service';
import { service } from '@ember/service';
import type CardService from '@cardstack/host/services/card-service';
import { RealmPaths } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';
import window from 'ember-window-mock';

type SerialRecentFile = [URL, string];

export interface RecentFile {
  realmURL: URL;
  filePath: string;
}

export default class RecentFilesService extends Service {
  @service declare cardService: CardService;

  @tracked recentFiles = new TrackedArray<RecentFile>([]);

  constructor(properties: object) {
    super(properties);

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

  // FIXME? LocalPath instead of string?
  removeRecentFile(file: string) {
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
    console.log(`addRecentFileUrl: ${url}`);
    let realmPaths = new RealmPaths(this.cardService.defaultURL);
    if (realmPaths.inRealm(new URL(url))) {
      this.addRecentFile(realmPaths.local(url));
    }
  }

  addRecentFile(file: string) {
    console.log(`addRecentFile: ${file}`);
    let currentRealmUrl = this.cardService.defaultURL;

    const existingIndex = this.findRecentFileIndex(file);

    if (existingIndex > -1) {
      this.recentFiles.splice(existingIndex, 1);
    }

    this.recentFiles.unshift({ realmURL: currentRealmUrl, filePath: file });

    if (this.recentFiles.length > 100) {
      this.recentFiles.pop();
    }

    this.persistRecentFiles();
  }

  persistRecentFiles() {
    console.log('persisting', JSON.stringify(this.recentFiles));
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

  private findRecentFileIndex(path: string) {
    let currentRealmUrl = this.cardService.defaultURL;

    return this.recentFiles.findIndex(
      ({ realmURL, filePath }) =>
        realmURL.href === currentRealmUrl.href && filePath === path,
    );
  }
}
