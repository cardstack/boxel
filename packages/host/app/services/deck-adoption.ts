import Service, { service } from '@ember/service';

import {
  DECKLIST_PATH,
  planDeckInstall,
  planDeckRemix,
  planDeckUse,
  rri,
  type DeckAdoptionPlan,
  type DeckLibSpec,
  type RealmIdentifier,
} from '@cardstack/runtime-common';

import type CardService from './card-service';
import type NetworkService from './network';
import type RealmService from './realm';

export type DeckAdoptionVerb = 'use' | 'install' | 'remix';

export interface AdoptDeckOptions {
  verb: DeckAdoptionVerb;
  spec: DeckLibSpec;
  targetRealm?: string;
  overrides?: unknown;
}

/**
 * The Host boundary for Deck adoption. Planning stays pure in runtime-common;
 * this service performs only the small decklist writes named by the plan.
 */
export default class DeckAdoptionService extends Service {
  @service declare private cardService: CardService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;

  async adopt(options: AdoptDeckOptions): Promise<DeckAdoptionPlan> {
    if (options.verb === 'use') {
      return planDeckUse(options.spec);
    }

    if (!options.targetRealm) {
      throw new Error(`${options.verb} requires a target realm`);
    }
    let targetRealm = this.realm.realmOf(rri(options.targetRealm));
    if (!targetRealm) {
      throw new Error(`unknown target realm: ${options.targetRealm}`);
    }

    let plan =
      options.verb === 'install'
        ? planDeckInstall(options.spec, await this.readDecklist(targetRealm))
        : planDeckRemix(options.spec, options.overrides);

    for (let write of plan.writes) {
      let url = new URL(write.path, this.realmURL(targetRealm));
      let existing = await this.cardService.getSource(url);
      let saveType;
      if (existing.status === 200) {
        saveType = 'editor' as const;
      } else if (existing.status === 404) {
        saveType = 'create-file' as const;
      } else {
        throw new Error(
          `could not inspect ${url.href}: source returned ${existing.status}`,
        );
      }
      await this.cardService.saveSource(url, write.contents, saveType);
    }

    return plan;
  }

  private async readDecklist(targetRealm: RealmIdentifier): Promise<unknown> {
    let url = new URL(DECKLIST_PATH, this.realmURL(targetRealm));
    let source = await this.cardService.getSource(url);
    if (source.status === 404) {
      return { imports: {}, scopes: {} };
    }
    if (source.status !== 200) {
      throw new Error(
        `could not read ${url.href}: source returned ${source.status}`,
      );
    }
    try {
      return JSON.parse(source.content);
    } catch (error) {
      throw new Error(`invalid Deck decklist at ${url.href}`, { cause: error });
    }
  }

  private realmURL(targetRealm: RealmIdentifier): URL {
    return this.network.virtualNetwork.toURL(targetRealm);
  }
}

declare module '@ember/service' {
  interface Registry {
    'deck-adoption': DeckAdoptionService;
  }
}
