import { getOwner } from '@ember/application';
import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { scheduleOnce } from '@ember/runloop';
import Component from '@glimmer/component';

import Modifier from 'ember-modifier';
import { consume, provide } from 'ember-provide-consume-context';

import { and, eq } from '@cardstack/boxel-ui/helpers';

import {
  CardContextName,
  GetCardContextName,
  PermissionsContextName,
  type Permissions,
  type getCard,
} from '@cardstack/runtime-common';

import HydratableCard from '@cardstack/host/components/search/hydratable-card';
import { renderWithArgs, teardown } from '@cardstack/host/lib/isolated-render';
import type { SandboxCardFieldMetadata } from '@cardstack/host/lib/realm-compartment-module-runtime';
import type { RealmSandboxRelationshipContext } from '@cardstack/host/services/realm-sandbox';

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
    format: Format;
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

  <template>
    <HydratableCard
      @cardId={{@cardId}}
      @format={{@format}}
      @mode='none'
      @overlays={{true}}
      @type={{@resourceType}}
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
  private element?: HTMLDivElement;
  private args?: DeferredRelationshipSignature['Args']['Named'];

  constructor(owner: Owner, args: ArgsFor<DeferredRelationshipSignature>) {
    super(owner, args);
    registerDestructor(this, () => {
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
    scheduleOnce('afterRender', this, this.renderCard);
  }

  private renderCard() {
    if (!this.element || !this.args) {
      return;
    }
    renderWithArgs(
      HostRelationshipCard as any,
      this.element as any,
      getOwner(this) as Owner,
      this.args,
    );
  }
}

class SandboxPermissionsConsumer extends Component<{
  Blocks: { default: [boolean] };
}> {
  @consume(PermissionsContextName) declare permissions: Permissions | undefined;

  get canWrite() {
    return this.permissions?.canWrite === true;
  }

  <template>{{yield this.canWrite}}</template>
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

      <template>
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
        {{/each}}
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

      get values() {
        return this.isMany && Array.isArray(this.value)
          ? this.value
          : undefined;
      }

      <template>
        <SandboxPermissionsConsumer as |canWrite|>
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
                    @canEdit={{and canWrite (eq this.format 'edit')}}
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
                @canEdit={{and canWrite (eq this.format 'edit')}}
              />
            {{/if}}
          {{/if}}
        </SandboxPermissionsConsumer>
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
