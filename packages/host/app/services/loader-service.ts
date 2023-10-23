import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import config from '@cardstack/host/config/environment';
import { shimExternals } from '@cardstack/host/lib/externals';

export default class LoaderService extends Service {
  @service declare fastboot: { isFastBoot: boolean };
  @tracked loader = this.makeInstance();

  reset() {
    this.loader = Loader.cloneLoader(this.loader);
    shimExternals(this.loader);
  }

  private makeInstance() {
    if (this.fastboot.isFastBoot) {
      let loader = new Loader();
      shimExternals(loader);
      return loader;
    }

    let loader = new Loader();
    loader.addURLMapping(
      new URL(baseRealm.url),
      new URL(config.resolvedBaseRealmURL),
    );
    shimExternals(loader);

    return loader;
  }
}
