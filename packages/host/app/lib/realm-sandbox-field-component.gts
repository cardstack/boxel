import Component from '@glimmer/component';

import HydratableCard from '@cardstack/host/components/search/hydratable-card';
import type { SandboxCardFieldMetadata } from '@cardstack/host/lib/realm-compartment-module-runtime';

import type {
  BaseDef,
  BaseDefComponent,
  Format,
} from '@cardstack/base/card-api';

export default function realmSandboxFieldComponent(
  snapshot: Record<string, unknown>,
  fieldName: string,
  trustedFieldType?: typeof BaseDef,
  containingFormat: Format = 'isolated',
  fieldKind: SandboxCardFieldMetadata['kind'] = 'contains',
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
        let value = snapshot[fieldName];
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

      <template>
        {{#each this.entries as |entry|}}
          <HydratableCard
            @cardId={{entry.id}}
            @format={{this.format}}
            @mode='none'
            @overlays={{true}}
            @type={{resourceType}}
          />
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
      readonly set = () => undefined;
      readonly isMany =
        fieldKind === 'containsMany' || fieldKind === 'linksToMany';

      get value() {
        return snapshot[fieldName];
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
        {{#if this.component}}
          {{#if this.values}}
            <div class='containsMany-field'>
              {{#each this.values as |value|}}
                {{! @glint-ignore Trusted field templates receive only the inert, read-only subset of the ordinary field component signature. }}
                <this.component
                  @cardOrField={{this.fieldType}}
                  @model={{value}}
                  @fields={{this.fields}}
                  @format={{this.format}}
                  @set={{this.set}}
                  @fieldName={{this.fieldName}}
                  @canEdit={{false}}
                />
              {{/each}}
            </div>
          {{else}}
            {{! @glint-ignore Trusted field templates receive only the inert, read-only subset of the ordinary field component signature. }}
            <this.component
              @cardOrField={{this.fieldType}}
              @model={{this.value}}
              @fields={{this.fields}}
              @format={{this.format}}
              @set={{this.set}}
              @fieldName={{this.fieldName}}
              @canEdit={{false}}
            />
          {{/if}}
        {{/if}}
      </template>
    } as unknown as BaseDefComponent;
  }

  return class RealmSandboxFieldValue extends Component {
    get value() {
      return snapshot[fieldName];
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
