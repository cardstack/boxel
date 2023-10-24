import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import config from '@cardstack/host/config/environment';
import { shimExternals } from '@cardstack/host/lib/externals';

import type { CardDef } from 'https://cardstack.com/base/card-api';

export default class LoaderService extends Service {
  @service declare fastboot: { isFastBoot: boolean };
  @tracked loader = this.makeInstance();

  reset() {
    this.loader = Loader.cloneLoader(this.loader);
    shimExternals(this.loader);
  }

  usingCurrentLoader(card: CardDef) {
    let cardDefinition = Object.getPrototypeOf(card).constructor;
    let cardLoader = Loader.getLoaderFor(cardDefinition);
    return this.loader === cardLoader;
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
