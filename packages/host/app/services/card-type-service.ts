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

  // Settled types only. Assembling a type is recursive, and the module
  // inspector assembles every declaration in a module concurrently — one root
  // per declaration. Two of those roots can reference each other (cards that
  // link both ways are ordinary), and each root breaks the cycle with its own
  // traversal stack. Sharing in-flight promises across roots keyed on the type
  // alone would close that cycle through the cache instead of the recursion,
  // where no stack can see it, and the two roots would await each other
  // forever. The cache is settled-only because it cannot tell those roots
  // apart, not because sharing is impossible: sharing that also accounts for
  // the traversal stack is safe, and `toType` does exactly that for the fields
  // of one card, where the stack is fixed.
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
    let moduleInfo = await this.moduleInfo(moduleIdentifier, loader);

    let api = await loader.import<typeof CardAPI>('@cardstack/base/card-api');
    let { id: _remove, ...fields } = api.getFields(card, {
      includeComputeds: true,
    });
    let superCard = getAncestor(card);
    let childStack = [card, ...stack];
    let superType: Type | CodeRefType | undefined;
    if (superCard && card !== superCard) {
      superType = await this.toType(superCard, loader, childStack);
    }

    // Every field below resolves against the same stack, so one shared promise
    // per distinct field type is what the several dozen color fields of a theme
    // card need in order to traverse `ColorField` once between them instead of
    // once each. Confined to this node's fan-out — which is what makes it safe
    // where a service-wide in-flight cache is not. A promise here is only ever
    // awaited by its siblings, and everything it awaits in turn sits deeper in
    // `childStack`, so these await edges only point away from the sharers and
    // can never close a cycle. See `typeCache` above for what does.
    let inFlight = new Map<typeof BaseDef, Promise<Type | CodeRefType>>();
    let resolveField = (fieldCard: typeof BaseDef) => {
      let existing = inFlight.get(fieldCard);
      if (!existing) {
        existing = this.toType(fieldCard, loader, childStack);
        inFlight.set(fieldCard, existing);
      }
      return existing;
    };

    let fieldTypes: FieldOfType[] = await Promise.all(
      Object.entries(fields).map(
        async ([name, field]: [string, Field<typeof BaseDef, any>]) => ({
          name,
          type: field.fieldType,
          isComputed: field.computeVia != undefined,
          isQueryField: field.queryDefinition != undefined,
          card: await resolveField(field.card),
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

  // The extension of the file a definition lives in. The loader records the
  // resolved, extension-bearing URL of every module it imports, and a
  // definition we hold a class for has necessarily been imported — so the
  // answer is normally already in memory and costs nothing. Only a module
  // whose recorded spelling carries no extension needs resolving over the
  // network: a shim registered under a bare specifier is recorded under that
  // specifier, and a loader replaced since the class was captured holds no
  // record at all.
  private async moduleInfo(
    moduleIdentifier: string,
    loader: Loader,
  ): Promise<ModuleInfo> {
    let extension = extensionOfURL(loader.canonicalURLFor(moduleIdentifier));
    if (extension) {
      return { extension };
    }
    return this.fetchedModuleInfo(
      this.network.virtualNetwork.toURL(moduleIdentifier),
    );
  }

  private fetchedModuleInfo(url: URL): Promise<ModuleInfo> {
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

  // The fallback for a module the loader cannot place. A code ref names its
  // module without an extension (`.../color`) and the realm resolves that to
  // the file the module lives in (`.../color.gts`), so the response URL
  // carries the extension — at the cost of a redirect plus a download of
  // source nothing here reads.
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
    // A handler that answers from memory rather than the network leaves
    // `response.url` empty, so fall back to what was asked for. That spelling
    // has no extension to give, which is the honest answer for a module that
    // was never resolved to a file.
    return { extension: extensionOfURL(response.url || url.href) };
  }
}

// The extension of a module spelling that may not be a URL at all — a shim's
// bare specifier, or nothing when the loader has no record. Anything that does
// not parse as a URL has no extension to report.
function extensionOfURL(href: string | undefined): string {
  if (!href) {
    return '';
  }
  try {
    return extensionOf(new URL(href).pathname);
  } catch {
    return '';
  }
}

// The extension of the last path segment, dot included, or '' when that
// segment has none. Confined to the last segment so a dotless filename under a
// dotted directory reports no extension rather than borrowing the directory's.
function extensionOf(pathname: string): string {
  let filename = pathname.split('/').pop() ?? '';
  let dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot);
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
