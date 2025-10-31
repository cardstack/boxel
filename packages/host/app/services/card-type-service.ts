import { service } from '@ember/service';
import Service from '@ember/service';

import type { RealmInfo } from '@cardstack/runtime-common';
import {
  identifyCard,
  internalKeyFor,
  baseRealm,
  moduleFrom,
  getAncestor,
  SupportedMimeType,
  isResolvedCodeRef,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { isCodeRef, type CodeRef } from '@cardstack/runtime-common/code-ref';
import type { Loader } from '@cardstack/runtime-common/loader';

import type CardService from '@cardstack/host/services/card-service';

import type {
  BaseDef,
  Field,
  FieldType,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';

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

export default class CardTypeService extends Service {
  @service declare private cardService: CardService;
  @service declare private network: NetworkService;
  @service declare private loaderService: LoaderService;

  private typeCache: Map<string, Type> = new Map();
  private moduleInfoCache: Map<string, ModuleInfo> = new Map();
  private loader: object | undefined; //keeps track of the current used loader so cache is reset after a loader reset

  invalidateAllCaches(): void {
    this.typeCache.clear();
    this.moduleInfoCache.clear();
  }

  async assembleType(definition: typeof BaseDef): Promise<Type> {
    // This should go away when we move to an architecture where NO loader reset is required
    if (this.loader !== this.loaderService.loader) {
      this.invalidateAllCaches();
      this.loader = this.loaderService.loader;
    }
    let maybeType = await this.toType(definition, this.loaderService.loader);
    if (isCodeRefType(maybeType)) {
      throw new Error(`bug: should never get here`);
    }
    return maybeType;
  }

  private async toType(
    card: typeof BaseDef,
    loader: Loader,
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
      this.moduleInfoCache.get(moduleIdentifier) ??
      (await this.fetchModuleInfo(new URL(moduleIdentifier)));

    let api = await loader.import<typeof CardAPI>(`${baseRealm.url}card-api`);
    let { id: _remove, ...fields } = api.getFields(card, {
      includeComputeds: true,
    });
    let superCard = getAncestor(card);
    let superType: Type | CodeRefType | undefined;
    if (superCard && card !== superCard) {
      superType = await this.toType(superCard, loader, [card, ...stack]);
    }

    let fieldTypes: FieldOfType[] = await Promise.all(
      Object.entries(fields).map(
        async ([name, field]: [string, Field<typeof BaseDef, any>]) => ({
          name,
          type: field.fieldType,
          isComputed: field.computeVia != undefined,
          card: await this.toType(field.card, loader, [card, ...stack]),
        }),
      ),
    );

    let type: Type = {
      id,
      module: moduleIdentifier,
      super: isCodeRefType(superType) ? undefined : superType,
      displayName: card.prototype.constructor.displayName || 'Card',
      fields: fieldTypes,
      moduleInfo,
      codeRef: ref,
      localName: card.name,
    };
    this.typeCache.set(id, type);
    return type;
  }

  private async fetchModuleInfo(url: URL): Promise<ModuleInfo> {
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
    this.moduleInfoCache.set(url.href, moduleInfo);
    return moduleInfo;
  }
}

function isCodeRefType(type: any): type is CodeRefType {
  return (
    type && isCodeRef(type) && 'displayName' in type && 'localName' in type
  );
}

export function isFieldOfType(obj: any): obj is FieldOfType {
  return obj && 'card' in obj;
}

export function getCodeRefFromType(t: Type | FieldOfType): CodeRef {
  let codeRef: CodeRef;
  if (isFieldOfType(t)) {
    codeRef = isCodeRefType(t.card) ? t.card : (t.card as Type).codeRef;
  } else {
    codeRef = t.codeRef;
  }
  return codeRef;
}

export function getResolvedCodeRefFromType(
  t: Type | FieldOfType,
): ResolvedCodeRef | undefined {
  let codeRef = getCodeRefFromType(t);
  if (!isResolvedCodeRef(codeRef)) {
    return;
  }
  return codeRef;
}

declare module '@ember/service' {
  interface Registry {
    'card-type-service': CardTypeService;
  }
}
