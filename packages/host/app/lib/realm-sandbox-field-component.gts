import { getOwner } from '@ember/application';
import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import { provide } from 'ember-provide-consume-context';

import {
  BrokenLinkTemplate,
  Button,
  IconButton,
} from '@cardstack/boxel-ui/components';
import type { BrokenLinkErrorDoc } from '@cardstack/boxel-ui/components';
import { and, eq } from '@cardstack/boxel-ui/helpers';
import { IconMinusCircle } from '@cardstack/boxel-ui/icons';

import {
  baseCardRef,
  CardContextName,
  CardCrudFunctionsContextName,
  CardURLContextName,
  cardTypeName,
  chooseCard,
  GetCardContextName,
  identifyCard,
  isCardInstance,
  isFileDefInstance,
  relativeTo,
  type CardErrorJSONAPI,
  type CodeRef,
  type getCard,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';
import {
  deferUntilIsolatedRenderCompletes,
  isInIsolatedRenderTransaction,
  renderWithArgs,
  rerenderSerializedComponent,
  teardown,
} from '@cardstack/host/lib/isolated-render';
import type { SandboxCardFieldMetadata } from '@cardstack/host/lib/realm-compartment-module-runtime';
import type { RealmSandboxRelationshipContext } from '@cardstack/host/services/realm-sandbox';
import type StoreService from '@cardstack/host/services/store';

import type {
  BaseDef,
  BaseDefComponent,
  CardContext,
  CardCrudFunctions,
  FieldType,
  Format,
} from '@cardstack/base/card-api';
import type { ArgsFor } from 'ember-modifier';

type RelationshipResourceType = 'card' | 'file-meta';

class HostRelationshipCard extends Component<{
  Args: {
    cardId: string;
    card?: BaseDef;
    errorDoc?: CardErrorJSONAPI;
    format: Format;
    fieldType: FieldType;
    fieldName: string;
    resourceType: RelationshipResourceType;
    relationshipContext: RealmSandboxRelationshipContext;
  };
}> {
  @provide(GetCardContextName)
  // @ts-ignore consumed by HydratableCard
  private get getCard(): getCard {
    return this.args.relationshipContext.getCard;
  }

  @provide(CardContextName)
  // @ts-ignore consumed by HydratableCard/CardRenderer
  private get cardContext(): CardContext | undefined {
    return this.args.relationshipContext.cardContext;
  }

  @provide(CardCrudFunctionsContextName)
  // @ts-ignore consumed by the trusted Base relationship renderer
  private get cardCrudFunctions(): CardCrudFunctions {
    // A delegated relationship is rendered in a separate host root so it does
    // not inherit the outer provider tree. Reintroduce only the navigation
    // capability explicitly; create/edit/save/delete remain unavailable.
    return {
      viewCard: this.args.relationshipContext.viewCard ?? (() => undefined),
    } as CardCrudFunctions;
  }

  private get brokenLinkFormat() {
    switch (this.args.format) {
      case 'isolated':
      case 'embedded':
      case 'fitted':
      case 'atom':
        return this.args.format;
      default:
        return 'embedded' as const;
    }
  }

  private get brokenLinkErrorDoc(): BrokenLinkErrorDoc | undefined {
    let errorDoc = this.args.errorDoc;
    if (!errorDoc) {
      return undefined;
    }
    return {
      message: errorDoc.message,
      stack: errorDoc.meta.stack ?? undefined,
      status: errorDoc.status,
      title: errorDoc.title,
    };
  }

  viewBrokenCard = (url: URL) => this.args.relationshipContext.viewCard?.(url);

  <template>
    {{#if @card}}
      <CardRenderer
        @card={{@card}}
        @format={{@format}}
        @fieldType={{@fieldType}}
        @fieldName={{@fieldName}}
        @displayContainer={{false}}
        @viewCard={{@relationshipContext.viewCard}}
        data-test-hydratable-card={{@cardId}}
      />
    {{else}}
      {{#let this.brokenLinkErrorDoc as |errorDoc|}}
        {{#if errorDoc}}
          <BrokenLinkTemplate
            @brokenUrl={{@cardId}}
            @errorDoc={{errorDoc}}
            @state={{if (eq errorDoc.status 404) 'not-found' 'error'}}
            @format={{this.brokenLinkFormat}}
            @displayName={{cardTypeName @cardId}}
            @itemType={{if (eq @resourceType 'file-meta') 'file' 'card'}}
            @viewCard={{this.viewBrokenCard}}
          />
        {{/if}}
      {{/let}}
    {{/if}}
  </template>
}

interface DeferredRelationshipSignature {
  Element: HTMLDivElement;
  Args: {
    Named: {
      cardId: string;
      format: Format;
      fieldType: FieldType;
      fieldName: string;
      resourceType: RelationshipResourceType;
      relationshipContext: RealmSandboxRelationshipContext;
      subscribeToData?: (render: () => void) => () => void;
    };
  };
}

// A delegated relationship renderer is host-owned, but invoking it while the
// SES component's low-level Glimmer transaction is still open corrupts the
// host tracking stack. Mount it as a separate host render on `afterRender`.
// This is an explicit presentation portal: only identity, format, and resource
// kind cross it; Store and loader authority remain inside HydratableCard.
class DeferredRelationshipCard extends Modifier<DeferredRelationshipSignature> {
  @service declare private store: StoreService;
  private element?: HTMLDivElement;
  private args?: DeferredRelationshipSignature['Args']['Named'];
  private generation = 0;
  private subscribeToData?: (render: () => void) => () => void;
  private unsubscribe?: () => void;

  constructor(owner: Owner, args: ArgsFor<DeferredRelationshipSignature>) {
    super(owner, args);
    registerDestructor(this, () => {
      this.generation++;
      this.unsubscribe?.();
      if (this.element) {
        teardown(this.element as any);
      }
    });
  }

  modify(
    element: HTMLDivElement,
    _positional: never[],
    args: DeferredRelationshipSignature['Args']['Named'],
  ) {
    this.element = element;
    this.args = args;
    if (this.subscribeToData !== args.subscribeToData) {
      this.unsubscribe?.();
      this.subscribeToData = args.subscribeToData;
      this.unsubscribe = args.subscribeToData?.(() => this.scheduleRender());
    }
    this.scheduleRender();
  }

  private scheduleRender() {
    this.generation++;
    if (
      isInIsolatedRenderTransaction() &&
      deferUntilIsolatedRenderCompletes(() => this.renderCard())
    ) {
      return;
    }
    scheduleOnce('afterRender', this, this.renderCard);
  }

  private async renderCard() {
    if (!this.element || !this.args) {
      return;
    }
    let generation = this.generation;
    let { cardId, resourceType } = this.args;
    let errorDoc =
      resourceType === 'file-meta'
        ? this.store.peekError(cardId, { type: 'file-meta' })
        : this.store.peekError(cardId);
    let loaded = errorDoc
      ? errorDoc
      : resourceType === 'file-meta'
        ? await this.store.get(cardId, { type: 'file-meta' })
        : await this.store.get(cardId);
    if (generation !== this.generation || !this.element || !this.args) {
      return;
    }
    let card =
      isCardInstance(loaded) || isFileDefInstance(loaded) ? loaded : undefined;
    errorDoc ??= card ? undefined : (loaded as CardErrorJSONAPI);
    renderWithArgs(
      HostRelationshipCard as any,
      this.element as any,
      getOwner(this) as Owner,
      { ...this.args, card, errorDoc },
    );
  }
}

interface TrustedFieldPortalArgs {
  component: BaseDefComponent;
  fieldType: typeof BaseDef;
  fieldName: string;
  format: Format;
  isMany: boolean;
  getValue: () => unknown;
  getCanWrite: () => boolean;
  getCardContext: () => CardContext | undefined;
  getCardURL: () => string | undefined;
  validateCodeRef?: (ref: CodeRef) => Promise<ResolvedCodeRef | undefined>;
  subscribeToData?: (render: () => void) => () => void;
  set: (value: unknown) => void;
  requestRender?: () => void;
}

class HostTrustedFieldPortal extends Component<{
  Args: TrustedFieldPortalArgs;
}> {
  readonly fields = {};
  private readonly providedCardContext: CardContext;

  constructor(owner: Owner, args: TrustedFieldPortalArgs) {
    super(owner, args);
    let source = args.getCardContext();
    // Code-mode previews do not always have an outer CardContext yet. The
    // trusted field island still needs its narrow sandbox capabilities, so
    // provide a minimal context whose prototype is the ordinary context when
    // one exists. Base's CardContextConsumer supplies unrelated defaults.
    this.providedCardContext = Object.assign(
      source ? Object.create(source) : Object.create(null),
      {
        requestRender: args.requestRender,
        validateCodeRef: args.validateCodeRef,
      },
    ) as CardContext;
  }

  @provide(CardContextName)
  // @ts-ignore consumed by trusted Base field editors
  private get cardContext(): CardContext {
    return this.providedCardContext;
  }

  @provide(CardURLContextName)
  // @ts-ignore consumed by trusted Base field editors
  private get cardURL() {
    return this.args.getCardURL();
  }

  get value() {
    return this.args.getValue();
  }

  get values() {
    return this.args.isMany && Array.isArray(this.value)
      ? this.value
      : undefined;
  }

  get canWrite() {
    return this.args.getCanWrite();
  }

  <template>
    {{#if @component}}
      {{#if this.values}}
        <div class='containsMany-field'>
          {{#each this.values as |value|}}
            {{! @glint-ignore Trusted field templates receive only the inert subset of the ordinary field component signature. }}
            <@component
              @cardOrField={{@fieldType}}
              @model={{value}}
              @fields={{this.fields}}
              @format={{@format}}
              @set={{@set}}
              @fieldName={{@fieldName}}
              @canEdit={{and this.canWrite (eq @format 'edit')}}
            />
          {{/each}}
        </div>
      {{else}}
        {{! @glint-ignore Trusted field templates receive only the inert subset of the ordinary field component signature. }}
        <@component
          @cardOrField={{@fieldType}}
          @model={{this.value}}
          @fields={{this.fields}}
          @format={{@format}}
          @set={{@set}}
          @fieldName={{@fieldName}}
          @canEdit={{and this.canWrite (eq @format 'edit')}}
        />
      {{/if}}
    {{/if}}
  </template>
}

interface DeferredTrustedFieldSignature {
  Element: HTMLDivElement;
  Args: { Named: TrustedFieldPortalArgs };
}

// Trusted Base/catalog field editors are deliberately outside the SES
// transaction. Besides limiting the capability bridge to their inert args,
// this gives their tracked state a normal Host Glimmer root (CodeMirror and
// other interactive Base editors otherwise cannot schedule rerenders through
// the foreign transaction).
class DeferredTrustedField extends Modifier<DeferredTrustedFieldSignature> {
  private element?: HTMLDivElement;
  private args?: TrustedFieldPortalArgs;
  private rendered = false;
  private unsubscribeFromData?: () => void;
  private requestRender = () => {
    if (this.element) {
      rerenderSerializedComponent(this.element as any);
    }
  };

  constructor(owner: Owner, args: ArgsFor<DeferredTrustedFieldSignature>) {
    super(owner, args);
    registerDestructor(this, () => {
      this.unsubscribeFromData?.();
      if (this.element) {
        teardown(this.element as any);
      }
    });
  }

  modify(
    element: HTMLDivElement,
    _positional: never[],
    args: TrustedFieldPortalArgs,
  ) {
    this.element = element;
    this.args = args;
    if (!this.unsubscribeFromData && args.subscribeToData) {
      // Trusted Base field templates live in their own Host render root so
      // DOM-aware editors never execute inside the SES transaction. Data
      // invalidation therefore has to cross that boundary explicitly; an
      // outer sandbox-island rerender cannot reach this independent root.
      this.unsubscribeFromData = args.subscribeToData(this.requestRender);
    }
    if (!this.rendered) {
      this.rendered = true;
      scheduleOnce('afterRender', this, this.renderField);
    }
  }

  private renderField() {
    if (!this.element || !this.args) {
      return;
    }
    renderWithArgs(
      HostTrustedFieldPortal as any,
      this.element as any,
      getOwner(this) as Owner,
      { ...this.args, requestRender: this.requestRender },
    );
  }
}

export default function realmSandboxFieldComponent(
  snapshot: () => Record<string, unknown>,
  fieldName: string,
  trustedFieldType?: typeof BaseDef,
  containingFormat: Format = 'isolated',
  fieldKind: SandboxCardFieldMetadata['kind'] = 'contains',
  fieldTypeDisplayName?: string,
  setField?: (fieldName: string, value: unknown) => void,
  getRelationshipContext?: () => RealmSandboxRelationshipContext | undefined,
  validateCodeRef?: (ref: CodeRef) => Promise<ResolvedCodeRef | undefined>,
  subscribeToData?: (render: () => void) => () => void,
): BaseDefComponent {
  if (fieldKind === 'linksTo' || fieldKind === 'linksToMany') {
    let defaultFormat: Format;
    switch (containingFormat) {
      case 'edit':
      case 'atom':
      case 'markdown':
      case 'head':
        defaultFormat = containingFormat;
        break;
      default:
        defaultFormat = 'embedded';
    }
    let resourceType = (
      trustedFieldType as (typeof BaseDef & { isFileDef?: boolean }) | undefined
    )?.isFileDef
      ? ('file-meta' as const)
      : ('card' as const);

    return class RealmSandboxRelationshipField extends Component<{
      Args: { displayContainer?: boolean; format?: Format };
    }> {
      get format() {
        return this.args.format ?? defaultFormat;
      }

      get entries() {
        let value = snapshot()[fieldName];
        let values = Array.isArray(value) ? value : [value];
        return values.flatMap((item) => {
          if (typeof item === 'string') {
            return [item];
          }
          if (typeof item !== 'object' || item === null) {
            return [];
          }
          let record = item as Record<string, unknown>;
          let id = record.id ?? record.url ?? record.sourceUrl;
          return typeof id === 'string' ? [id] : [];
        });
      }

      get relationshipContext() {
        return getRelationshipContext?.();
      }

      get canWrite() {
        return this.relationshipContext?.canWrite() === true;
      }

      get hasEntries() {
        return this.entries.length > 0;
      }

      remove = () => {
        setField?.(fieldName, fieldKind === 'linksToMany' ? [] : null);
      };

      add = () => this.chooseRelationship.perform();

      private chooseRelationship = restartableTask(async () => {
        let type = identifyCard(trustedFieldType) ?? baseCardRef;
        let selected =
          fieldKind === 'linksToMany'
            ? await chooseCard(
                { filter: { type } },
                {
                  multiSelect: true,
                  title: fieldTypeDisplayName
                    ? `Select 1 or more ${fieldTypeDisplayName} cards`
                    : undefined,
                },
              )
            : await chooseCard(
                { filter: { type } },
                {
                  multiSelect: false,
                  title: fieldTypeDisplayName
                    ? `Choose a ${fieldTypeDisplayName} card`
                    : undefined,
                },
              );
        if (!selected) {
          return;
        }
        let ids = Array.isArray(selected) ? selected : [selected];
        let store = this.relationshipContext?.cardContext?.store;
        if (!store) {
          return;
        }
        let cards = await Promise.all(ids.map((id) => store.get(id)));
        let values = cards.filter(isCardInstance);
        setField?.(
          fieldName,
          fieldKind === 'linksToMany' ? values : (values[0] ?? null),
        );
      });

      <template>
        <div
          class='realm-sandbox-relationship-field'
          data-test-links-to-editor={{if (eq fieldKind 'linksTo') fieldName}}
          data-test-links-to-many={{if (eq fieldKind 'linksToMany') fieldName}}
        >
          {{#if (and this.canWrite this.hasEntries)}}
            <IconButton
              @icon={{IconMinusCircle}}
              @width='20px'
              @height='20px'
              aria-label='Remove'
              data-test-remove-card
              {{on 'click' this.remove}}
            />
          {{/if}}
          {{#each this.entries key='@identity' as |cardId|}}
            {{#if this.relationshipContext}}
              <div
                class='realm-sandbox-delegated-relationship'
                {{DeferredRelationshipCard
                  cardId=cardId
                  format=this.format
                  fieldType=fieldKind
                  fieldName=fieldName
                  resourceType=resourceType
                  relationshipContext=this.relationshipContext
                  subscribeToData=subscribeToData
                }}
              ></div>
            {{/if}}
          {{else}}
            {{#if this.canWrite}}
              <Button
                @kind='secondary'
                @size='tall'
                @rectangular={{true}}
                data-test-add-new={{fieldName}}
                {{on 'click' this.add}}
              >
                Link
              </Button>
            {{else}}
              - Empty -
            {{/if}}
          {{/each}}
        </div>
      </template>
    } as unknown as BaseDefComponent;
  }

  if (trustedFieldType) {
    let fieldType = trustedFieldType;
    let format: Format;
    switch (containingFormat) {
      case 'edit':
      case 'atom':
      case 'markdown':
      case 'head':
        format = containingFormat;
        break;
      default:
        format = 'embedded';
    }
    let components = fieldType as unknown as Record<
      string,
      BaseDefComponent | undefined
    >;
    return class RealmSandboxTrustedField extends Component<{
      Args: { displayContainer?: boolean; format?: Format };
    }> {
      readonly fieldType = fieldType;
      readonly fieldName = fieldName;
      readonly set = (value: unknown) => setField?.(fieldName, value);
      readonly isMany =
        fieldKind === 'containsMany' || fieldKind === 'linksToMany';
      readonly getValue = () => this.value;
      readonly getCanWrite = () => this.canWrite;
      readonly getCardContext = () => getRelationshipContext?.()?.cardContext;
      readonly getCardURL = () => {
        let id = snapshot().id;
        return typeof id === 'string' ? id : undefined;
      };

      get value() {
        let state = snapshot();
        let value = state[fieldName];
        let ownerId = state.id;
        let addReferenceBase = (item: unknown) => {
          if (
            typeof ownerId === 'string' &&
            typeof item === 'object' &&
            item !== null &&
            Object.isExtensible(item) &&
            !(relativeTo in item)
          ) {
            Object.defineProperty(item, relativeTo, {
              configurable: true,
              enumerable: false,
              value: ownerId,
            });
          }
        };
        if (Array.isArray(value)) {
          value.forEach(addReferenceBase);
        } else {
          addReferenceBase(value);
        }
        return value;
      }

      get format() {
        return this.args.format ?? format;
      }

      get component() {
        return components[this.format] ?? components.embedded;
      }

      get canWrite() {
        return getRelationshipContext?.()?.canWrite() === true;
      }

      get values() {
        return this.isMany && Array.isArray(this.value)
          ? this.value
          : undefined;
      }

      <template>
        {{#if this.component}}
          <div
            class='realm-sandbox-trusted-field'
            {{DeferredTrustedField
              component=this.component
              fieldType=this.fieldType
              fieldName=this.fieldName
              format=this.format
              isMany=this.isMany
              getValue=this.getValue
              getCanWrite=this.getCanWrite
              getCardContext=this.getCardContext
              getCardURL=this.getCardURL
              validateCodeRef=validateCodeRef
              subscribeToData=subscribeToData
              set=this.set
            }}
          ></div>
        {{/if}}
      </template>
    } as unknown as BaseDefComponent;
  }

  return class RealmSandboxFieldValue extends Component {
    get value() {
      return snapshot()[fieldName];
    }

    get values() {
      return Array.isArray(this.value) ? this.value : undefined;
    }

    get displayValue() {
      let value = this.value;
      if (value == null) {
        return '';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    }

    <template>
      {{#if this.values}}
        <ul class='realm-sandbox-field-list'>
          {{#each this.values as |value|}}
            <li>{{value}}</li>
          {{/each}}
        </ul>
      {{else}}
        {{this.displayValue}}
      {{/if}}
    </template>
  } as unknown as BaseDefComponent;
}
