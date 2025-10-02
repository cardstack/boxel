import { service } from '@ember/service';

import { isScopedCSSRequest } from 'glimmer-scoped-css';

import {
  isCardInstance,
  LooseSingleCardDocument,
  SupportedMimeType,
} from '@cardstack/runtime-common';

import * as CardAPI from 'https://cardstack.com/base/card-api';
import * as BaseCommandModule from 'https://cardstack.com/base/command';

import { Spec } from 'https://cardstack.com/base/spec';

import HostBaseCommand from '../lib/host-base-command';
import { skillCardURL } from '../lib/utils';

import UseAiAssistantCommand from './ai-assistant';
import CreateSpecCommand from './create-specs';

import type CardService from '../services/card-service';
import type NetworkService from '../services/network';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

type ListingType = 'card' | 'app' | 'skill';
const listingSubClass: Record<'card' | 'app' | 'skill', string> = {
  card: 'CardListing',
  app: 'AppListing',
  skill: 'SkillListing',
};

class ListingTypeGuessser {
  constructor(private specs: Spec[]) {}

  get type(): ListingType {
    if (this.isSkillListing) {
      return 'skill';
    }
    if (this.isAppListing) {
      return 'app';
    }
    return 'card';
  }

  get isSkillListing() {
    return this.specs.length == 0;
  }
  get isAppListing() {
    return Boolean(this.specs.find((s) => s.specType === 'app'));
  }
}

export default class ListingCreateCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingCreateInput,
  typeof BaseCommandModule.ListingCreateResult
> {
  @service declare private cardService: CardService;
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;

  description = 'Create catalog listing command';

  #cardAPI?: typeof CardAPI;

  async loadCardAPI() {
    if (!this.#cardAPI) {
      this.#cardAPI = await this.loaderService.loader.import<typeof CardAPI>(
        'https://cardstack.com/base/card-api',
      );
    }
    return this.#cardAPI;
  }

  get catalogRealm() {
    return this.realmServer.catalogRealmURLs.find((realm) =>
      realm.endsWith('/catalog/'),
    );
  }

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ListingCreateInput } = commandModule;
    return ListingCreateInput;
  }

  requireInputFields = ['openCardId'];

  private sanitizeDeps(deps: string[]) {
    return deps.filter((dep) => {
      // Exclude scoped CSS requests
      if (isScopedCSSRequest(dep)) {
        return false;
      }
      // Exclude known global/package/icon sources
      if (
        [
          'https://cardstack.com',
          'https://packages',
          'https://boxel-icons.boxel.ai',
        ].some((urlStem) => dep.startsWith(urlStem))
      ) {
        return false;
      }

      // Only allow deps that belong to a realm we can read
      const url = new URL(dep);
      const realmURL = this.realm.realmOfURL(url);
      if (!realmURL) {
        return false;
      }
      return this.realm.canRead(realmURL.href);
    });
  }

  protected async run(
    input: BaseCommandModule.ListingCreateInput,
  ): Promise<BaseCommandModule.ListingCreateResult> {
    const cardAPI = await this.loadCardAPI();

    let { openCardId, targetRealm: targetRealmFromInput } = input;

    if (!openCardId) {
      throw new Error('Card id is required');
    }

    const instance = await this.store.get<CardAPI.CardDef>(openCardId);

    if (!isCardInstance(instance)) {
      throw new Error('Instance is not a card');
    }

    const targetRealm =
      targetRealmFromInput ?? instance[cardAPI.realmURL]?.href;

    if (!targetRealm) {
      throw new Error('Realm not found');
    }

    const response = await this.network.authedFetch(
      `${targetRealm}_dependencies?url=${openCardId}`,
      {
        headers: {
          Accept: SupportedMimeType.CardDependencies,
        },
      },
    );
    if (!response.ok) {
      throw new Error('Failed to fetch dependencies');
    }
    const deps = (await response.json()) as string[];
    const sanitizedDeps = this.sanitizeDeps(deps ?? []);

    const createSpecCommand = new CreateSpecCommand(this.commandContext);
    let specIds: string[] = [];
    let specs: Spec[] = [];
    for (const dep of sanitizedDeps) {
      const result = await createSpecCommand.execute({
        module: dep,
        targetRealm,
      });
      for (const spec of result.specs ?? []) {
        if (spec.id) {
          specIds.push(spec.id);
          specs.push(spec);
        }
      }
    }

    const listingType = new ListingTypeGuessser(specs).type;

    let relationships = {} as Record<string, { links: { self: string } }>;

    if (specIds.length > 0) {
      specIds.forEach((id, index) => {
        relationships[`specs.${index}`] = {
          links: {
            self: id,
          },
        };
      });
    }

    if (openCardId) {
      relationships['examples.0'] = {
        links: {
          self: openCardId,
        },
      };
    }

    let listingDoc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        relationships: {
          ...relationships,
        },
        meta: {
          adoptsFrom: {
            module: `${this.catalogRealm}catalog-app/listing/listing`,
            name: listingSubClass[listingType],
          },
        },
      },
    };

    const listing = await this.store.add(listingDoc, {
      realm: targetRealm,
    });
    if (!listing.id) {
      throw new Error('Failed to create listing card');
    }
    await this.operatorModeStateService.openCardInInteractMode(listing.id);

    await new UseAiAssistantCommand(this.commandContext).execute({
      prompt: `Update information for the listing, find the possible category and tags for the listing based in catalog-realm and update the listing card ${listing.id}`,
      roomId: 'new',
      openRoom: true,
      llmModel: 'anthropic/claude-sonnet-4',
      llmMode: 'act',
      openCardIds: [listing.id!],
      attachedCards: [listing as CardAPI.CardDef],
      skillCardIds: [
        skillCardURL('boxel-environment'),
        skillCardURL('catalog-listing'),
      ],
    });

    let commandModule = await this.loadCommandModule();
    const { ListingCreateResult } = commandModule;

    return new ListingCreateResult({ listing });
  }
}
