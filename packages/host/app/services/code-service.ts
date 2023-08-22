import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';

export default class CodeService extends Service {
  @tracked recentFiles = new TrackedArray<string>([]);

  constructor() {
    super();

    let recentFilesString = localStorage.getItem('recent-files');

    if (recentFilesString) {
      try {
        this.recentFiles = new TrackedArray(JSON.parse(recentFilesString));
      } catch (e) {
        console.log('Error restoring recent files', e);
      }
    }
  }

  persistRecentFiles() {
    localStorage.setItem('recent-files', JSON.stringify(this.recentFiles));
  }
}
