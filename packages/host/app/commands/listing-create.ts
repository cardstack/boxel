import { service } from '@ember/service';

import { isScopedCSSRequest } from 'glimmer-scoped-css';

import {
  isCardInstance,
  loadCardDef,
  specRef,
  ResolvedCodeRef,
  LooseSingleCardDocument,
  SupportedMimeType,
} from '@cardstack/runtime-common';

import {
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
} from '@cardstack/runtime-common/code-ref';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import {
  type CardOrFieldDeclaration,
  type ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';

import * as CardAPI from 'https://cardstack.com/base/card-api';
import * as BaseCommandModule from 'https://cardstack.com/base/command';

import { Spec, type SpecType } from 'https://cardstack.com/base/spec';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type NetworkService from '../services/network';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

const listingTypes: Record<'card' | 'app' | 'skill', string> = {
  card: 'CardListing',
  app: 'AppListing',
  skill: 'SkillListing',
};

export default class ListingCreateCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingCreateInput
> {
  @service declare private cardService: CardService;
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private network: NetworkService;

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
    return this.realmServer.catalogRealmURLs[0];
  }

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ListingCreateInput } = commandModule;
    return ListingCreateInput;
  }

  async createSpecTask(
    ref: ResolvedCodeRef,
    specType: SpecType,
    realm: string,
  ): Promise<Spec | undefined> {
    let relativeTo = new URL(ref.module);
    let maybeAbsoluteRef = codeRefWithAbsoluteURL(ref, relativeTo);
    if (isResolvedCodeRef(maybeAbsoluteRef)) {
      ref = maybeAbsoluteRef;
    }
    try {
      let SpecKlass = await loadCardDef(specRef, {
        loader: this.loaderService.loader,
      });
      let spec = new SpecKlass({
        specType,
        ref,
        title: ref.name,
      }) as Spec;
      return (await this.store.add(spec, {
        realm,
      })) as Spec;
    } catch (e) {
      console.log('Error saving', e);
      return undefined;
    }
  }

  private isApp(selectedDeclaration: CardOrFieldDeclaration) {
    if (selectedDeclaration.exportName === 'AppCard') {
      return true;
    }
    if (
      selectedDeclaration.super &&
      selectedDeclaration.super.type === 'external' &&
      selectedDeclaration.super.name === 'AppCard'
    ) {
      return true;
    }
    return false;
  }

  private async guessSpecType(
    selectedDeclaration: ModuleDeclaration,
  ): Promise<SpecType> {
    if (selectedDeclaration.type === 'possibleCardOrField') {
      if (
        selectedDeclaration.super?.type === 'external' &&
        selectedDeclaration.super.name === 'CardDef'
      ) {
        if (this.isApp(selectedDeclaration)) {
          return 'app';
        }
        return 'card';
      }
      if (
        selectedDeclaration.super?.type === 'external' &&
        selectedDeclaration.super.name === 'FieldDef'
      ) {
        return 'field';
      }
    }
    throw new Error('Unidentified spec');
  }

  private sanitizeDeps(deps: string[]) {
    return deps.filter((dep) => {
      if (isScopedCSSRequest(dep)) {
        return false;
      }
      if (
        [
          'https://cardstack.com',
          'https://packages',
          'https://boxel-icons.boxel.ai',
        ].some((urlStem) => dep.startsWith(urlStem))
      ) {
        return false;
      }
      return true;
    });
  }

  protected async run(
    input: BaseCommandModule.ListingCreateInput,
  ): Promise<undefined> {
    const cardAPI = await this.loadCardAPI();

    let { openCardId } = input;

    if (!openCardId) {
      throw new Error('Card id is required');
    }

    const instance = await this.store.get<CardAPI.CardDef>(openCardId);

    if (!isCardInstance(instance)) {
      throw new Error('Instance is not a card');
    }

    const targetRealm = instance[cardAPI.realmURL]?.href;

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

    let guessListingType: keyof typeof listingTypes = 'card';
    let moduleRefs: {
      fromModule: string;
      codeRefName: string;
      specType: SpecType;
    }[] = [];
    let specIds: string[] = [];
    let relationships = {} as Record<string, { links: { self: string } }>;

    for (const dep of sanitizedDeps) {
      const url = new URL(dep);
      let moduleSource = (await this.cardService.getSource(url)).content;
      let moduleSyntax = new ModuleSyntax(moduleSource, url);

      const moduleDeclaration = moduleSyntax.declarations.find(
        (declaration) => declaration.exportName !== undefined,
      );
      if (!moduleDeclaration) {
        throw new Error('Module declaration not found');
      }
      const specType = await this.guessSpecType(
        moduleDeclaration as CardOrFieldDeclaration,
      );

      if (moduleDeclaration) {
        moduleRefs.push({
          fromModule: dep,
          codeRefName: moduleDeclaration.exportName || '',
          specType,
        });
      }
    }

    // create spec from gts
    for (const moduleRef of moduleRefs) {
      const spec = await this.createSpecTask(
        {
          module: moduleRef.fromModule,
          name: moduleRef.codeRefName || '',
        },
        moduleRef.specType,
        targetRealm,
      );
      if (spec !== undefined) {
        specIds.push(spec.id || '');
      }
    }

    // guess listing type
    // if there is no gts to install, we assume it's a skill
    if (moduleRefs.length === 0) {
      guessListingType = 'skill';
    }
    if (moduleRefs.length > 1) {
      guessListingType = 'app';
    }

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
            name: listingTypes[guessListingType],
          },
        },
      },
    };

    await this.store.add(listingDoc, {
      realm: targetRealm,
      doNotWaitForPersist: true,
    });
  }
}
