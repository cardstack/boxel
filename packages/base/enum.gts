import GlimmerComponent from '@glimmer/component';
import { isEqual } from 'lodash';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { getField } from '@cardstack/runtime-common';
import { resolveFieldConfiguration } from './field-support';
import type { FieldDefConstructor } from './card-api';
import { not } from '@cardstack/boxel-ui/helpers';

// enumField factory moved out of card-api: creates a FieldDef subclass with
// editor/atom wired to read options via configuration.enum.*
export type RichOption = { value: any; label?: string; icon?: any };
// Typed configuration shape for enum fields
export type EnumConfiguration = {
  enum?: {
    options?: any[]; // Future: type this more thoroughly after .value refactor lands
    unsetLabel?: string;
  };
};
export type EnumConfigurationInput<T> =
  | EnumConfiguration
  | ((self: Readonly<T>) => EnumConfiguration | undefined);

// Helper to make authoring configuration more discoverable in TS
// Convenience helper: accept either the nested EnumConfiguration shape
// or a shallow shape { options?, unsetLabel? }, and ensure the result
// is always nested under the `enum` key. Works for both POGO and
// function forms.
export function enumConfig<T>(
  input:
    | EnumConfigurationInput<T>
    | ({ options?: any[]; unsetLabel?: string } | undefined)
    | ((self: Readonly<T>) =>
        | EnumConfiguration
        | { options?: any[]; unsetLabel?: string }
        | undefined),
): EnumConfigurationInput<T> {
  function normalize(
    v: EnumConfiguration | { options?: any[]; unsetLabel?: string } | undefined,
  ): EnumConfiguration | undefined {
    if (!v) return undefined;
    if (typeof v === 'object' && 'enum' in v) {
      return v as EnumConfiguration;
    }
    return { enum: v as { options?: any[]; unsetLabel?: string } };
  }

  if (typeof input === 'function') {
    return (function (this: Readonly<T>) {
      return normalize((input as any).call(this));
    }) as any;
  }
  return normalize(input as any) as EnumConfiguration;
}

export function normalizeEnumOptions(rawOpts: any[]): RichOption[] {
  let normalized = (rawOpts ?? []).map((v) =>
    v && typeof v === 'object' && 'value' in v
      ? (v as RichOption)
      : ({ value: v, label: String(v) } as RichOption),
  );
  // Detect duplicate values (deep equality on value to support compound types)
  let seen: any[] = [];
  for (let opt of normalized) {
    let dup = seen.find((v) => isEqual(v, opt.value));
    if (dup !== undefined) {
      throw new Error(
        `enum configuration error: duplicate option value '${String(opt.value)}' detected`,
      );
    }
    seen.push(opt.value);
  }
  return normalized;
}

export function enumAllowedValues(rawOpts: any[]): any[] {
  return normalizeEnumOptions(rawOpts).map((o) => o.value);
}

// Helper-style utility: returns normalized rich options for a given model/fieldName
export function enumOptions(model: object, fieldName: string): RichOption[] {
  let field = getField(model as any, fieldName);
  let cfg = resolveFieldConfiguration(field as any, model as any) as
    | { enum?: { options?: any[] } }
    | undefined;
  let opts = cfg?.enum?.options ?? [];
  return normalizeEnumOptions(opts);
}

// Helper-style utility: returns primitive allowed values for a given model/fieldName
export function enumValues(model: object, fieldName: string): any[] {
  let field = getField(model as any, fieldName);
  let cfg = resolveFieldConfiguration(field as any, model as any) as
    | { enum?: { options?: any[] } }
    | undefined;
  let opts = cfg?.enum?.options ?? [];
  return enumAllowedValues(opts);
}

function enumField<BaseT extends FieldDefConstructor>(
  Base: BaseT,
  config: { options: any; displayName?: string; icon?: any },
): BaseT {
  class EnumField extends (Base as any) {
    static configuration =
      typeof (config as any)?.options === 'function'
        ? function (this: any) {
            return { enum: { options: (config as any).options.call(this) } };
          }
        : ({
            enum: { options: (config as any)?.options },
          } as EnumConfiguration);
    static displayName =
      (config as any)?.displayName ?? (Base as any).displayName;
    static icon = (config as any)?.icon ?? (Base as any).icon;

    static atom = class Atom extends GlimmerComponent<any> {
      get normalizedOptions() {
        let cfg = this.args.configuration as
          | { enum?: { options?: any[] } }
          | undefined;
        let opts = cfg?.enum?.options ?? [];
        return normalizeEnumOptions(opts);
      }
      get unsetLabel() {
        let cfg = this.args.configuration as
          | { enum?: { unsetLabel?: string } }
          | undefined;
        return cfg?.enum?.unsetLabel;
      }
      get option() {
        let v = this.args.model as any;
        let opts = this.normalizedOptions as any[];
        if (v == null) {
          let explicit = opts.find((o: any) => o.value === null);
          if (explicit) return explicit;
          return { value: null, label: this.unsetLabel ?? '—' };
        }
        return (
          opts.find((o: any) => isEqual(o.value, v)) ?? {
            value: v,
            label: String(v),
          }
        );
      }
      get isUnsetFallback() {
        return (
          this.args.model == null &&
          !this.normalizedOptions.find((o: any) => o.value === null)
        );
      }
      get isValueFallback() {
        let v = this.args.model as any;
        if (v == null) return false;
        return !this.normalizedOptions.find((o: any) => isEqual(o.value, v));
      }
      <template>
        {{#if this.option}}
          {{#if this.option.icon}}
            <this.option.icon class='option-icon' width='16' height='16' />
          {{/if}}
          <span
            class='option-title'
            data-test-enum-atom-unset={{if this.isUnsetFallback true false}}
            data-test-enum-atom-fallback={{if this.isValueFallback true false}}
          >
            {{if this.option.label this.option.label this.option.value}}
          </span>
        {{/if}}
      </template>
    };

    static selectedItem = class SelectedItem extends GlimmerComponent<{
      Args: { option: any; configuration?: any };
    }> {
      <template>
        {{#if @option}}
          {{#let (component EnumField.atom) as |Atom|}}
            <Atom @model={{@option.value}} @configuration={{@configuration}} />
          {{/let}}
        {{/if}}
      </template>
    };

    static edit = class Edit extends GlimmerComponent<any> {
      get options() {
        let cfg = this.args.configuration as
          | { enum?: { options?: any[]; unsetLabel?: string } }
          | undefined;
        let opts = cfg?.enum?.options ?? [];
        return normalizeEnumOptions(opts);
      }
      get hasExplicitNullOption() {
        return (this.options as any[]).some((o: any) => o?.value === null);
      }
      get placeholder() {
        if ((this.args.model as any) == null && !this.hasExplicitNullOption) {
          let cfg = this.args.configuration as
            | { enum?: { unsetLabel?: string } }
            | undefined;
          return cfg?.enum?.unsetLabel ?? 'Choose…';
        }
        return undefined;
      }
      get selectedOption() {
        let opts = this.options as any[];
        let found = opts.find((o: any) => isEqual(o.value, (this.args.model as any)));
        return found === undefined ? undefined : found;
      }
      update = (opt: any) => {
        this.args.set?.(opt?.value ?? null);
      };
      <template>
        <BoxelSelect
          @options={{this.options}}
          @selected={{this.selectedOption}}
          @onChange={{this.update}}
          @selectedItemComponent={{if
            this.selectedOption
            (component EnumField.selectedItem configuration=@configuration)
          }}
          @disabled={{not @canEdit}}
          @renderInPlace={{true}}
          @placeholder={{this.placeholder}}
          as |opt|
        >
          {{#let (component EnumField.atom) as |Atom|}}
            <Atom @model={{opt.value}} @configuration={{@configuration}} />
          {{/let}}
        </BoxelSelect>
      </template>
    };
  }
  return EnumField as unknown as BaseT;
}

export default enumField;
