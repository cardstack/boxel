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

import { Button, IconButton } from '@cardstack/boxel-ui/components';
import { and, eq } from '@cardstack/boxel-ui/helpers';
import { IconMinusCircle } from '@cardstack/boxel-ui/icons';

import {
  baseCardRef,
  CardContextName,
  chooseCard,
  GetCardContextName,
  identifyCard,
  isCardInstance,
  isFileDefInstance,
  type getCard,
} from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';
import { renderWithArgs, teardown } from '@cardstack/host/lib/isolated-render';
import type { SandboxCardFieldMetadata } from '@cardstack/host/lib/realm-compartment-module-runtime';
import type { RealmSandboxRelationshipContext } from '@cardstack/host/services/realm-sandbox';
import type StoreService from '@cardstack/host/services/store';

import type {
  BaseDef,
  BaseDefComponent,
  CardContext,
  Format,
} from '@cardstack/base/card-api';
import type { ArgsFor } from 'ember-modifier';

type RelationshipResourceType = 'card' | 'file-meta';

class HostRelationshipCard extends Component<{
  Args: {
    cardId: string;
    card: BaseDef;
    format: Format;
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

  <template>
    <CardRenderer
      @card={{@card}}
      @format={{@format}}
      @displayContainer={{false}}
      @viewCard={{@relationshipContext.viewCard}}
      data-test-hydratable-card={{@cardId}}
    />
  </template>
}

interface DeferredRelationshipSignature {
  Element: HTMLDivElement;
  Args: {
    Named: {
      cardId: string;
      format: Format;
      resourceType: RelationshipResourceType;
      relationshipContext: RealmSandboxRelationshipContext;
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

  constructor(owner: Owner, args: ArgsFor<DeferredRelationshipSignature>) {
    super(owner, args);
    registerDestructor(this, () => {
      this.generation++;
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
    this.generation++;
    scheduleOnce('afterRender', this, this.renderCard);
  }

  private async renderCard() {
    if (!this.element || !this.args) {
      return;
    }
    let generation = this.generation;
    let { cardId, resourceType } = this.args;
    let card =
      resourceType === 'file-meta'
        ? await this.store.get(cardId, { type: 'file-meta' })
        : await this.store.get(cardId);
    if (
      generation !== this.generation ||
      (!isCardInstance(card) && !isFileDefInstance(card))
    ) {
      return;
    }
    renderWithArgs(
      HostRelationshipCard as any,
      this.element as any,
      getOwner(this) as Owner,
      { ...this.args, card },
    );
  }
}

export default function realmSandboxFieldComponent(
  snapshot: () => Record<string, unknown>,
  fieldName: string,
  trustedFieldType?: typeof BaseDef,
  containingFormat: Format = 'isolated',
  fieldKind: SandboxCardFieldMetadata['kind'] = 'contains',
  setField?: (fieldName: string, value: unknown) => void,
  getRelationshipContext?: () => RealmSandboxRelationshipContext | undefined,
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
            return [{ id: item }];
          }
          if (typeof item !== 'object' || item === null) {
            return [];
          }
          let record = item as Record<string, unknown>;
          let id = record.id ?? record.url ?? record.sourceUrl;
          return typeof id === 'string' ? [{ id }] : [];
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
            ? await chooseCard({ filter: { type } }, { multiSelect: true })
            : await chooseCard({ filter: { type } }, { multiSelect: false });
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
          data-test-links-to-editor={{fieldName}}
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
          {{#each this.entries as |entry|}}
            {{#if this.relationshipContext}}
              <div
                class='realm-sandbox-delegated-relationship'
                {{DeferredRelationshipCard
                  cardId=entry.id
                  format=this.format
                  resourceType=resourceType
                  relationshipContext=this.relationshipContext
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
      readonly fields = {};
      readonly fieldName = fieldName;
      readonly set = (value: unknown) => setField?.(fieldName, value);
      readonly isMany =
        fieldKind === 'containsMany' || fieldKind === 'linksToMany';

      get value() {
        return snapshot()[fieldName];
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
          {{#if this.values}}
            <div class='containsMany-field'>
              {{#each this.values as |value|}}
                {{! @glint-ignore Trusted field templates receive only the inert subset of the ordinary field component signature. }}
                <this.component
                  @cardOrField={{this.fieldType}}
                  @model={{value}}
                  @fields={{this.fields}}
                  @format={{this.format}}
                  @set={{this.set}}
                  @fieldName={{this.fieldName}}
                  @canEdit={{and this.canWrite (eq this.format 'edit')}}
                />
              {{/each}}
            </div>
          {{else}}
            {{! @glint-ignore Trusted field templates receive only the inert subset of the ordinary field component signature. }}
            <this.component
              @cardOrField={{this.fieldType}}
              @model={{this.value}}
              @fields={{this.fields}}
              @format={{this.format}}
              @set={{this.set}}
              @fieldName={{this.fieldName}}
              @canEdit={{and this.canWrite (eq this.format 'edit')}}
            />
          {{/if}}
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
