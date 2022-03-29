import Route from '@ember/routing/route';
import { launchWorker } from 'runtime-spike/lib/launch-worker';

export default class Application extends Route {
  async beforeModel() {
    await launchWorker();
  }
}
