import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { Loader } from '@cardstack/runtime-common/loader';
import { baseRealm } from '@cardstack/runtime-common';

export default class LoaderService extends Service {
  @tracked loader: Loader;

  constructor(properties: object) {
    super(properties);
    let loader = new Loader();
    loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    this.loader = loader;
  }
}
