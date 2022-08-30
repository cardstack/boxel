import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { CardRef, ExportedCardRef } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import {
  CardDefinitionResource,
  getExportedCardContext,
} from '@cardstack/runtime-common/realm';
import { isCardRef } from '@cardstack/runtime-common/search-index';
import { stringify, parse } from 'qs';
import { service } from '@ember/service';
import LocalRealm from '../services/local-realm';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

interface Args {
  named: {
    ref: ExportedCardRef;
    // moduleSyntax is unconsumed, rather we are using it was a way to
    // invalidate the resource so that we refetch the type when we see the
    // moduleSyntax has changed
    moduleSyntax: ModuleSyntax;
  };
}

interface Type {
  id: string;
  exportedCardContext: {
    module: string;
    name: string;
  };
  super: Type | undefined;
  fields: { name: string; card: Type; type: 'contains' | 'containsMany' }[];
}

export class CardType extends Resource<Args> {
  @tracked type: Type | undefined;
  @service declare localRealm: LocalRealm;
  @tracked localRealmURL: URL;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    if (!this.localRealm.isAvailable) {
      throw new Error('Local realm is not available');
    }
    this.localRealmURL = this.localRealm.url;
    let { ref } = args.named;
    taskFor(this.assembleType).perform({ type: 'exportedCard', ...ref });
  }

  @restartableTask private async assembleType(ref: CardRef) {
    let url = `${this.localRealmURL.href}_typeOf?${stringify(ref)}`;
    let type = await this.makeCardType(url);
    this.type = type;
  }

  private async makeCardType(typeOfURL: string): Promise<Type> {
    let ref = parse(new URL(typeOfURL).search, { ignoreQueryPrefix: true });
    if (!isCardRef(ref)) {
      throw new Error(
        `The url ${typeOfURL} does not contain a valid card reference`
      );
    }
    let { module, name } = getExportedCardContext(ref);

    let def = await this.load(typeOfURL);
    return {
      id: def.id,
      exportedCardContext: { module, name },
      super: def.relationships._super
        ? await this.makeCardType(def.relationships._super.links.related)
        : undefined,
      fields: (
        await Promise.all(
          Object.entries(
            def.relationships as CardDefinitionResource['relationships']
          ).map(async ([fieldName, fieldDef]) => {
            if (fieldName === '_super') {
              return undefined;
            }
            return {
              name: fieldName,
              card: await this.makeCardType(fieldDef.links.related),
              type: fieldDef.meta.type,
            };
          })
        )
      ).filter(Boolean) as Type['fields'],
    };
  }

  private async load(typeOfURL: string): Promise<CardDefinitionResource> {
    let response = await Loader.fetch(typeOfURL, {
      headers: {
        Accept: 'application/vnd.api+json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Could not load card type for ${typeOfURL}: ${
          response.status
        } - ${await response.text()}`
      );
    }

    let json = await response.json();
    return json.data as CardDefinitionResource;
  }
}

export function getCardType(
  parent: object,
  ref: () => ExportedCardRef,
  moduleSyntax: () => ModuleSyntax
) {
  return useResource(parent, CardType, () => ({
    named: { ref: ref(), moduleSyntax: moduleSyntax() },
  }));
}
