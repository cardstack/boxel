import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { ExportedCardRef } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { stringify } from 'qs';
import { service } from '@ember/service';
import LocalRealm from '../services/local-realm';

interface Args {
  named: { module: string };
}

export class CardRefs extends Resource<Args> {
  @tracked refs: ExportedCardRef[] = [];
  @service declare localRealm: LocalRealm;
  @tracked localRealmURL: URL;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    if (!this.localRealm.isAvailable) {
      throw new Error('Local realm is not available');
    }
    this.localRealmURL = this.localRealm.url;
    let { module } = args.named;
    taskFor(this.getCardRefs).perform(module);
  }

  @restartableTask private async getCardRefs(module: string) {
    let response = await Loader.fetch(
      `${this.localRealmURL.href}_cardsOf?${stringify({
        module,
      })}`,
      {
        headers: {
          Accept: 'application/vnd.api+json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Could not load card refs for module ${module}: ${
          response.status
        } - ${await response.text()}`
      );
    }
    let json = await response.json();
    this.refs =
      (json.data.attributes?.cardExports as ExportedCardRef[] | undefined) ??
      [];
  }
}

export function getCardRefsForModule(parent: object, module: () => string) {
  return useResource(parent, CardRefs, () => ({
    named: { module: module() },
  }));
}
