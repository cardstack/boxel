import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';

export default class CodeService extends Service {
  @tracked recentFiles = new TrackedArray<string>([]);
}
