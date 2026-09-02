import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Service from '@ember/service';

import {
  identifyCard,
  internalKeyFor,
  moduleFrom,
  getAncestor,
  SupportedMimeType,
  isResolvedCodeRef,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { isCodeRef, type CodeRef } from '@cardstack/runtime-common/code-ref';
import type { Loader } from '@cardstack/runtime-common/loader';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type SessionService from '../services/session';
import type * as CardAPI from '@cardstack/base/card-api';
import type { BaseDef, Field, FieldType } from '@cardstack/base/card-api';

export type CodeRefType = CodeRef & {
  displayName: string;
  localName: string;
};

export interface FieldOfType {
  name: string;
  card: Type | CodeRefType;
  isComputed: boolean;
  isQueryField: boolean;
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
}

export default class CardTypeService extends Service {
  @service declare private network: NetworkService;
  @service declare private loaderService: LoaderService;
  @service declare private session: SessionService;

  // Settled types only, deliberately: assembling a type is recursive, and the
  // module inspector assembles every declaration in a module concurrently. Two
  // of those roots can reference each other — cards that link both ways are
  // ordinary — and each root breaks the cycle with its own traversal stack.
  // Sharing in-flight type promises across roots would defeat those stacks,
  // leaving each root awaiting the other's.
  private typeCache: Map<string, Type> = new Map();

  // The in-flight promise, not the settled value. A card's fields are assembled
  // concurrently, so every field that shares a type asks for that type's module
  // before the first of them has answered — keyed on the settled value, the
  // several dozen color fields of a theme card would each fetch `color.gts` for
  // themselves. Nothing reached from here recurses back into type assembly, so
  // sharing the promise is safe, and it is what keeps the concurrent traversals
  // above from repeating each other's fetches.
  private moduleInfoCache: Map<string, Promise<ModuleInfo>> = new Map();
  private loader: object | undefined; //keeps track of the current used loader so cache is reset after a loader reset

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  resetState() {
    this.invalidateAllCaches();
    this.loader = undefined;
  }

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
    let id = internalKeyFor(ref, undefined, this.network.virtualNetwork);
    let cached = this.typeCache.get(id);
    if (cached) {
      return cached;
    }
    let moduleIdentifier = moduleFrom(ref);
    let moduleURL = this.network.virtualNetwork.toURL(moduleIdentifier);
    let moduleInfo = await this.moduleInfo(moduleURL);

    let api = await loader.import<typeof CardAPI>('@cardstack/base/card-api');
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
          isQueryField: field.queryDefinition != undefined,
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

  private moduleInfo(url: URL): Promise<ModuleInfo> {
    let pending = this.moduleInfoCache.get(url.href);
    if (!pending) {
      pending = this.fetchModuleInfo(url);
      this.moduleInfoCache.set(url.href, pending);
      // A rejection is dropped so the next caller retries: a failed fetch is a
      // property of that attempt, not of the module. Scoped to the promise that
      // failed, so a cache cleared and repopulated meanwhile keeps its newer
      // entry.
      pending.catch(() => {
        if (this.moduleInfoCache.get(url.href) === pending) {
          this.moduleInfoCache.delete(url.href);
        }
      });
    }
    return pending;
  }

  // The extension is only knowable from the response: a code ref names its
  // module without one (`.../color`), and the realm redirects that to the file
  // the module actually lives in (`.../color.gts`).
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
    return {
      extension: '.' + new URL(response.url).pathname.split('.').pop() || '',
    };
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
