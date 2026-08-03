import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Service from '@ember/service';

import type { RealmInfo } from '@cardstack/runtime-common';
import {
  internalKeyFor,
  moduleFrom,
  getAncestor,
  SupportedMimeType,
  isResolvedCodeRef,
  rri,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { isCodeRef, type CodeRef } from '@cardstack/runtime-common/code-ref';
import {
  basicMappings,
  generateJsonSchemaForCardType,
  type AttributesSchema,
  type CardSchema,
} from '@cardstack/runtime-common/helpers/ai';
import { Loader } from '@cardstack/runtime-common/loader';

import { FieldPathParser } from '@cardstack/host/lib/field-path-parser';
import {
  identifyRealmCard,
  type OpaqueRealmCardFieldMetadata,
  type OpaqueRealmCardTypeState,
} from '@cardstack/host/lib/realm-sandbox-boundary';
import type CardService from '@cardstack/host/services/card-service';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';

import type { ValidateFieldPathResult } from '../lib/field-path-parser';
import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type SessionService from '../services/session';
import type * as CardAPI from '@cardstack/base/card-api';
import type { BaseDef, Field, FieldType } from '@cardstack/base/card-api';
import type { CardDef, FieldDef } from '@cardstack/base/card-api';

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

export interface CardDefinitionIntrospection {
  typeRef: CodeRef;
  displayName: string;
  localName: string;
  headerColor: string | null;
  hasCustomEditTemplate: boolean;
  hasCustomIsolatedTemplate: boolean;
  prefersWideFormat: boolean;
  fields?: Record<string, OpaqueRealmCardFieldMetadata>;
}

interface ModuleInfo {
  extension: string;
  realmInfo: RealmInfo;
}

export default class CardTypeService extends Service {
  @service declare private cardService: CardService;
  @service declare private network: NetworkService;
  @service declare private loaderService: LoaderService;
  @service declare private realmSandbox: RealmSandboxService;
  @service declare private session: SessionService;

  private typeCache: Map<string, Type> = new Map();
  private moduleInfoCache: Map<string, ModuleInfo> = new Map();
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

  introspect(
    cardOrDefinition: BaseDef | typeof BaseDef,
  ): CardDefinitionIntrospection | undefined {
    let opaque = this.realmSandbox.introspectOpaqueCardType(cardOrDefinition);
    let definition = this.definitionFor(cardOrDefinition);
    let typeRef = identifyRealmCard(cardOrDefinition);
    if (!definition || !typeRef) {
      return undefined;
    }
    return {
      typeRef,
      displayName:
        opaque?.displayName ?? definition.prototype.constructor.displayName,
      localName:
        opaque && isResolvedCodeRef(typeRef) ? typeRef.name : definition.name,
      headerColor:
        opaque?.headerColor ??
        (typeof (definition as typeof CardDef).headerColor === 'string'
          ? (definition as typeof CardDef).headerColor
          : null),
      hasCustomEditTemplate:
        opaque?.hasCustomEditTemplate ??
        (definition as typeof CardDef).hasCustomEditTemplate === true,
      hasCustomIsolatedTemplate:
        opaque?.hasCustomIsolatedTemplate ??
        (definition as typeof CardDef).hasCustomIsolatedTemplate === true,
      prefersWideFormat:
        opaque?.prefersWideFormat ??
        (definition as typeof CardDef).prefersWideFormat === true,
      fields: opaque?.fields,
    };
  }

  async assembleType(
    cardOrDefinition: BaseDef | typeof BaseDef,
  ): Promise<Type> {
    // This should go away when we move to an architecture where NO loader reset is required
    if (this.loader !== this.loaderService.loader) {
      this.invalidateAllCaches();
      this.loader = this.loaderService.loader;
    }
    let definition = this.definitionFor(cardOrDefinition);
    if (!definition) {
      throw new Error('cannot introspect card without a definition');
    }
    let maybeType = await this.toType(definition, this.loaderService.loader);
    if (isCodeRefType(maybeType)) {
      throw new Error(`bug: should never get here`);
    }
    return maybeType;
  }

  async patchSchema(
    cardOrDefinition: BaseDef | typeof BaseDef,
    cardApi?: typeof CardAPI,
    mappings?: Map<typeof FieldDef, AttributesSchema>,
  ): Promise<CardSchema> {
    let definition = this.definitionFor(cardOrDefinition);
    if (!definition) {
      throw new Error('cannot generate schema without a card definition');
    }
    let opaque = this.realmSandbox.introspectOpaqueCardType(definition);
    let loader =
      (opaque ? undefined : Loader.getLoaderFor(definition)) ??
      this.loaderService.loader;
    cardApi ??= await loader.import<typeof CardAPI>('@cardstack/base/card-api');
    if (!mappings) {
      let mappingsLoader = loader;
      if (!opaque) {
        // A test realm or a secondary trusted loader can own the definition
        // while its field classes come from another matching Base loader.
        // Preserve the pre-sandbox lookup so class-identity-based primitive
        // mappings remain valid.
        let cardFields = cardApi.getFields(definition, {
          usedLinksToFieldsOnly: false,
        });
        mappingsLoader =
          Object.values(cardFields)
            .map((field) => Loader.getLoaderFor(field.card))
            .find((candidate): candidate is Loader => Boolean(candidate)) ??
          loader;
      }
      mappings = await basicMappings(mappingsLoader);
    }
    let adapted = await this.cardAPIIntrospectionAdapter(
      definition,
      cardApi,
      loader,
    );
    return generateJsonSchemaForCardType(
      adapted.definition as typeof CardDef,
      adapted.cardApi,
      mappings,
    );
  }

  async validateFieldPath(
    cardOrDefinition: BaseDef | typeof BaseDef,
    fieldPath: string[],
  ): Promise<ValidateFieldPathResult> {
    let definition = this.definitionFor(cardOrDefinition);
    if (!definition) {
      return {
        isValid: false,
        parts: fieldPath,
        reason: 'Card definition is unavailable',
      };
    }
    let loader = this.loaderService.loader;
    let cardApi = await loader.import<typeof CardAPI>(
      '@cardstack/base/card-api',
    );
    let adapted = await this.cardAPIIntrospectionAdapter(
      definition,
      cardApi,
      loader,
    );
    return FieldPathParser.validatedFieldPath(
      fieldPath,
      adapted.definition as typeof CardDef,
      adapted.cardApi.getFields,
    );
  }

  private definitionFor(
    cardOrDefinition: BaseDef | typeof BaseDef,
  ): typeof BaseDef | undefined {
    return typeof cardOrDefinition === 'function'
      ? cardOrDefinition
      : (cardOrDefinition.constructor as typeof BaseDef | undefined);
  }

  private async cardAPIIntrospectionAdapter(
    definition: typeof BaseDef,
    cardApi: typeof CardAPI,
    loader: Loader,
  ): Promise<{ definition: typeof BaseDef; cardApi: typeof CardAPI }> {
    let opaque = this.realmSandbox.introspectOpaqueCardType(definition);
    if (!opaque) {
      return { definition, cardApi };
    }

    let syntheticDefinition = class SandboxedCardIntrospection {};
    let fields: Record<string, Field<typeof BaseDef, any>> = {};
    for (let [name, metadata] of Object.entries(opaque.fields)) {
      let namespace = await loader.import<Record<string, unknown>>(
        metadata.type.module,
      );
      let fieldDefinition = namespace[metadata.type.name];
      if (typeof fieldDefinition !== 'function') {
        continue;
      }
      fields[name] = {
        card: fieldDefinition as typeof BaseDef,
        fieldType: metadata.kind,
      } as Field<typeof BaseDef, any>;
    }
    let getFields = (
      candidate: typeof BaseDef,
      options?: Parameters<typeof cardApi.getFields>[1],
    ) =>
      candidate === (syntheticDefinition as unknown as typeof BaseDef)
        ? fields
        : cardApi.getFields(candidate, options);
    let getFieldDescription = (
      candidate: BaseDef | typeof BaseDef,
      name: string,
    ) =>
      candidate === (syntheticDefinition as unknown as typeof BaseDef)
        ? undefined
        : cardApi.getFieldDescription(candidate, name);
    return {
      definition: syntheticDefinition as unknown as typeof BaseDef,
      cardApi: {
        ...cardApi,
        getFields,
        getFieldDescription,
      },
    };
  }

  private async toType(
    card: typeof BaseDef,
    loader: Loader,
    stack: (typeof BaseDef)[] = [],
  ): Promise<Type | CodeRefType> {
    let opaqueType = this.realmSandbox.introspectOpaqueCardType(card);
    if (opaqueType) {
      return this.toOpaqueType(opaqueType, loader);
    }
    let maybeRef = identifyRealmCard(card);
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
    let moduleInfo =
      this.moduleInfoCache.get(moduleURL.href) ??
      (await this.fetchModuleInfo(moduleURL));

    let superType: Type | CodeRefType | undefined;
    let api = await loader.import<typeof CardAPI>('@cardstack/base/card-api');
    let { id: _remove, ...fields } = api.getFields(card, {
      includeComputeds: true,
    });
    let superCard = getAncestor(card);
    if (superCard && card !== superCard) {
      superType = await this.toType(superCard, loader, [card, ...stack]);
    }

    let fieldTypes = await Promise.all(
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

  private async toOpaqueType(
    opaqueType: Readonly<OpaqueRealmCardTypeState>,
    loader: Loader,
    stack: string[] = [],
  ): Promise<Type | CodeRefType> {
    let ref = opaqueType.typeRef;
    let id = internalKeyFor(ref, undefined, this.network.virtualNetwork);
    if (stack.includes(id)) {
      return {
        ...ref,
        displayName: opaqueType.displayName,
        localName: isResolvedCodeRef(ref) ? ref.name : opaqueType.displayName,
      };
    }
    let cached = this.typeCache.get(id);
    if (cached) {
      return cached;
    }
    let moduleIdentifier = moduleFrom(ref);
    let moduleURL = this.network.virtualNetwork.toURL(moduleIdentifier);
    let moduleInfo =
      this.moduleInfoCache.get(moduleURL.href) ??
      (await this.fetchModuleInfo(moduleURL));

    let superType: Type | CodeRefType | undefined;
    let ancestor = opaqueType.ancestorTypes[0];
    if (ancestor) {
      let ancestorRef = {
        module: rri(ancestor.module),
        name: ancestor.name,
      } satisfies CodeRef;
      let opaqueAncestor =
        await this.realmSandbox.introspectOpaqueCardTypeRef(ancestorRef);
      if (opaqueAncestor) {
        superType = await this.toOpaqueType(opaqueAncestor, loader, [
          id,
          ...stack,
        ]);
      } else {
        let ancestorModule = await loader.import<Record<string, unknown>>(
          ancestor.module,
        );
        let ancestorDefinition = ancestorModule[ancestor.name];
        if (typeof ancestorDefinition === 'function') {
          superType = await this.toType(
            ancestorDefinition as typeof BaseDef,
            loader,
          );
        }
      }
    }

    let type: Type = {
      id,
      module: moduleIdentifier,
      super: isCodeRefType(superType) ? undefined : superType,
      displayName: opaqueType.displayName,
      fields: await this.opaqueFieldTypes(opaqueType.fields, loader),
      moduleInfo,
      codeRef: ref,
      localName: isResolvedCodeRef(ref) ? ref.name : opaqueType.displayName,
    };
    this.typeCache.set(id, type);
    return type;
  }

  private async opaqueFieldTypes(
    fields: Record<string, OpaqueRealmCardFieldMetadata>,
    loader: Loader,
  ): Promise<FieldOfType[]> {
    return Promise.all(
      Object.entries(fields).map(async ([name, field]) => {
        let ref = {
          module: rri(field.type.module),
          name: field.type.name,
        } satisfies CodeRef;
        let opaqueFieldType =
          await this.realmSandbox.introspectOpaqueCardTypeRef(ref);
        let card: Type | CodeRefType;
        if (opaqueFieldType) {
          // A field row needs identity and presentation, not the referenced
          // definition's entire schema. Keeping this as an inert leaf avoids
          // recursively assembling mutually-referential authored types while
          // still making the definition navigable in code mode.
          card = {
            ...ref,
            displayName: opaqueFieldType.displayName,
            localName: field.type.name,
          };
        } else {
          // Only trusted Base/catalog definitions reach the ordinary loader.
          // Authored field definitions are described through inert sandbox
          // metadata above, including their own inheritance chain.
          let module = await loader.import<Record<string, unknown>>(
            field.type.module,
          );
          let definition = module[field.type.name];
          if (typeof definition !== 'function') {
            throw new Error(
              `cannot load field type ${field.type.name} from ${field.type.module}`,
            );
          }
          card = await this.toType(definition as typeof BaseDef, loader);
        }
        return {
          name,
          type: field.kind,
          isComputed: false,
          isQueryField: false,
          card,
        };
      }),
    );
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
