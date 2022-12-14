import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { Loader } from '@cardstack/runtime-common/loader';
import { baseRealm } from '@cardstack/runtime-common';

export default class LoaderService extends Service {
  @service declare fastboot: { isFastBoot: boolean };
  @tracked loader = this.makeInstance();

  reset() {
    this.loader = Loader.cloneLoader(this.loader);
  }

  private makeInstance() {
    let loader = new Loader();
    if (!this.fastboot.isFastBoot) {
      loader.addURLMapping(
        new URL(baseRealm.url),
        new URL('http://localhost:4201/base/')
      );
    }
    return loader;
  }
}
