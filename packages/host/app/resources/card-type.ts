import { getOwner } from '@ember/application';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import {
  identifyCard,
  internalKeyFor,
  baseRealm,
  moduleFrom,
  getAncestor,
  RealmInfo,
} from '@cardstack/runtime-common';
import { SupportedMimeType } from '@cardstack/runtime-common';
import {
  isCodeRef,
  type CodeRef,
  isResolvedCodeRef,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common/code-ref';
import { Loader } from '@cardstack/runtime-common/loader';

import type CardService from '@cardstack/host/services/card-service';

import type {
  BaseDef,
  Field,
  FieldType,
} from 'https://cardstack.com/base/card-api';

import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';

interface Args {
  named: {
    definition: typeof BaseDef;
    loader: Loader;
  };
}

export type CodeRefType = CodeRef & {
  displayName: string;
  localName: string;
};

export interface FieldOfType {
  name: string;
  card: Type | CodeRefType;
  isComputed: boolean;
  type: FieldType;
}

export interface Type {
  id: string;
  module: string;
  displayName: string;
  super: Type | undefined;
  fields: FieldOfType[];
  codeRef: CodeRef;
  moduleInfo: ModuleInfo;
  localName: string;
}

interface ModuleInfo {
  extension: string;
  realmInfo: RealmInfo;
}

const moduleInfoCache: Map<string, ModuleInfo> = new Map();

export class CardType extends Resource<Args> {
  @tracked type: Type | undefined;
  @service declare private cardService: CardService;
  @service declare private network: NetworkService;
  declare loader: Loader;
  typeCache: Map<string, Type> = new Map();
  ready: Promise<void> | undefined;

  modify(_positional: never[], named: Args['named']) {
    let { definition, loader } = named;
    this.loader = loader;
    this.ready = this.assembleType.perform(definition);
  }

  get isLoading() {
    return this.assembleType.isRunning;
  }

  private assembleType = restartableTask(async (card: typeof BaseDef) => {
    let maybeType = await this.toType(card);
    if (isCodeRefType(maybeType)) {
      throw new Error(`bug: should never get here`);
    }
    this.type = maybeType;
  });

  private async toType(
    card: typeof BaseDef,
    stack: (typeof BaseDef)[] = [],
  ): Promise<Type | CodeRefType> {
    let maybeRef = identifyCard(card);
    if (!maybeRef) {
      throw new Error(`cannot identify card ${card.name}`);
    }
    let ref = maybeRef;
    if (stack.includes(card)) {
      return {
        ...ref,
        displayName: card.prototype.constructor.displayName,
        localName: card.name,
      };
    }
    let id = internalKeyFor(ref, undefined);
    let cached = this.typeCache.get(id);
    if (cached) {
      return cached;
    }
    let moduleIdentifier = moduleFrom(ref);
    let moduleInfo =
      moduleInfoCache.get(moduleIdentifier) ??
      (await this.fetchModuleInfo(new URL(moduleIdentifier)));

    let api = await this.loader.import<typeof CardAPI>(
      `${baseRealm.url}card-api`,
    );
    let { id: _remove, ...fields } = api.getFields(card, {
      includeComputeds: true,
    });
    let superCard = getAncestor(card);
    let superType: Type | CodeRefType | undefined;
    if (superCard && card !== superCard) {
      superType = await this.toType(superCard, [card, ...stack]);
    }
    if (isCodeRefType(superType)) {
      throw new Error(
        `bug: encountered cycle in card ancestor: ${[
          superType,
          ...stack.map((c) => identifyCard(c)),
        ]
          .map((r) => JSON.stringify(r))
          .join()}`,
      );
    }
    let fieldTypes: FieldOfType[] = await Promise.all(
      Object.entries(fields).map(
        async ([name, field]: [string, Field<typeof BaseDef, any>]) => ({
          name,
          type: field.fieldType,
          isComputed: field.computeVia != undefined,
          card: await this.toType(field.card, [card, ...stack]),
        }),
      ),
    );

    let type: Type = {
      id,
      module: moduleIdentifier,
      super: superType,
      displayName: card.prototype.constructor.displayName || 'Card',
      fields: fieldTypes,
      moduleInfo,
      codeRef: ref,
      localName: card.name,
    };
    this.typeCache.set(id, type);
    return type;
  }

  async isClassInChain(
    card: typeof BaseDef,
    codeRef: ResolvedCodeRef | undefined,
  ): Promise<boolean> {
    if (!codeRef) {
      return false;
    }

    const type = (await this.toType(card)) as Type;

    // check root level is already matching the codeRef
    if (type.localName === codeRef.name && type.module === codeRef.module) {
      return true;
    }

    // else, check if the recursive super class is matching the codeRef
    let superCard = getAncestor(card);
    if (superCard && card !== superCard) {
      return this.isClassInChain(superCard, codeRef);
    }
    return false;
  }

  private fetchModuleInfo = async (url: URL) => {
    let response = await this.network.authedFetch(url, {
      headers: { Accept: SupportedMimeType.CardSource },
    });

    if (!response.ok) {
      throw new Error(
        `Could not get file ${url.href}, status ${response.status}: ${
          response.statusText
        } - ${await response.text()}`,
      );
    }
    let realmURL = response.headers.get('x-boxel-realm-url');
    if (realmURL === null) {
      throw new Error(`Could not get realm url for ${url.href}`);
    }
    let realmInfo = await this.cardService.getRealmInfoByRealmURL(
      new URL(realmURL),
    );
    let moduleInfo = {
      realmInfo,
      extension: '.' + new URL(response.url).pathname.split('.').pop() || '',
    };
    moduleInfoCache.set(url.href, moduleInfo);
    return moduleInfo;
  };
}

export function getCardType(
  parent: object,
  card: () => typeof BaseDef,
  loader?: () => Loader,
) {
  return CardType.from(parent, () => ({
    named: {
      definition: card(),
      loader: loader
        ? loader()
        : (
            (getOwner(parent) as any).lookup(
              'service:loader-service',
            ) as LoaderService
          ).loader,
    },
  })) as CardType;
}

function isCodeRefType(type: any): type is CodeRefType {
  return (
    type && isCodeRef(type) && 'displayName' in type && 'localName' in type
  );
}

export function isFieldOfType(obj: any): obj is FieldOfType {
  return obj && 'card' in obj;
}

export function getCodeRef(t: Type | FieldOfType): ResolvedCodeRef | undefined {
  let codeRef: CodeRef;
  if (isFieldOfType(t)) {
    codeRef = isCodeRefType(t.card) ? t.card : t.card.codeRef;
  } else {
    codeRef = t.codeRef;
  }
  if (!isResolvedCodeRef(codeRef)) {
    return undefined;
  }
  return codeRef;
}
