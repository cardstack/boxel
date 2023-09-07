import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';
import ENV from '@cardstack/host/config/environment';
import window from 'ember-window-mock';

const { ownRealmURL } = ENV;

export default class CodeService extends Service {
  @tracked recentFiles = new TrackedArray<string>([]);

  constructor() {
    super();

    let recentFilesString = window.localStorage.getItem('recent-files');

    if (recentFilesString) {
      try {
        this.recentFiles = new TrackedArray(JSON.parse(recentFilesString));
      } catch (e) {
        console.log('Error restoring recent files', e);
      }
    }
  }

  persistRecentFiles() {
    window.localStorage.setItem(
      'recent-files',
      JSON.stringify(this.recentFiles),
    );
  }

  // TODO HASSAN START HERE FRI
  deleteFile(url: URL) {}
}
