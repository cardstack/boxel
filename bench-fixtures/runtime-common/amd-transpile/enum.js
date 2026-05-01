import GlimmerComponent from '@glimmer/component';
import { isEqual } from 'lodash';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { getField } from '@cardstack/runtime-common';
import { resolveFieldConfiguration } from './field-support';
import { markdownEscape, not } from '@cardstack/boxel-ui/helpers';
// enumField factory moved out of card-api: creates a FieldDef subclass with
// editor/atom wired to read options via configuration.enum.*
import { setComponentTemplate } from "@ember/component";
import { createTemplateFactory } from "@ember/template-factory"; // Typed configuration shape for enum fields
// Helper to make authoring configuration more discoverable in TS
// Convenience helper: accept either the nested EnumConfiguration shape
// or a shallow shape { options?, unsetLabel? }, and ensure the result
// is always nested under the `enum` key. Works for both POGO and
// function forms.
export function enumConfig(input) {
  function normalize(v) {
    if (!v) return undefined;
    if (typeof v === 'object' && 'enum' in v) {
      return v;
    }
    return {
      enum: v
    };
  }
  if (typeof input === 'function') {
    return function () {
      return normalize(input.call(this));
    };
  }
  return normalize(input);
}
export function normalizeEnumOptions(rawOpts) {
  let normalized = (rawOpts ?? []).map(v => v && typeof v === 'object' && 'value' in v ? v : {
    value: v,
    label: String(v)
  });
  // Detect duplicate values (deep equality on value to support compound types)
  let seen = [];
  for (let opt of normalized) {
    let dup = seen.find(v => isEqual(v, opt.value));
    if (dup !== undefined) {
      throw new Error(`enum configuration error: duplicate option value '${String(opt.value)}' detected`);
    }
    seen.push(opt.value);
  }
  return normalized;
}
export function enumAllowedValues(rawOpts) {
  return normalizeEnumOptions(rawOpts).map(o => o.value);
}
// Helper-style utility: returns normalized rich options for a given model/fieldName
export function enumOptions(model, fieldName) {
  let field = getField(model, fieldName);
  let cfg = resolveFieldConfiguration(field, model);
  let opts = cfg?.enum?.options ?? [];
  return normalizeEnumOptions(opts);
}
// Helper-style utility: returns primitive allowed values for a given model/fieldName
export function enumValues(model, fieldName) {
  let field = getField(model, fieldName);
  let cfg = resolveFieldConfiguration(field, model);
  let opts = cfg?.enum?.options ?? [];
  return enumAllowedValues(opts);
}
function enumField(Base, config) {
  class EnumField extends Base {
    static configuration = typeof config?.options === 'function' ? function () {
      return {
        enum: {
          options: config.options.call(this)
        }
      };
    } : {
      enum: {
        options: config?.options
      }
    };
    static displayName = config?.displayName ?? Base.displayName;
    static icon = config?.icon ?? Base.icon;
    static atom = class Atom extends GlimmerComponent {
      get normalizedOptions() {
        let cfg = this.args.configuration;
        let opts = cfg?.enum?.options ?? [];
        return normalizeEnumOptions(opts);
      }
      get unsetLabel() {
        let cfg = this.args.configuration;
        return cfg?.enum?.unsetLabel;
      }
      get option() {
        let v = this.args.model;
        let opts = this.normalizedOptions;
        if (v == null) {
          let explicit = opts.find(o => o.value === null);
          if (explicit) return explicit;
          return {
            value: null,
            label: this.unsetLabel ?? '—'
          };
        }
        return opts.find(o => isEqual(o.value, v)) ?? {
          value: v,
          label: String(v)
        };
      }
      get isUnsetFallback() {
        return this.args.model == null && !this.normalizedOptions.find(o => o.value === null);
      }
      get isValueFallback() {
        let v = this.args.model;
        if (v == null) return false;
        return !this.normalizedOptions.find(o => isEqual(o.value, v));
      }
      static {
        setComponentTemplate(createTemplateFactory(
        /*
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
        */
        {
          "id": "K9iUgW3S",
          "block": "[[[41,[30,0,[\"option\"]],[[[41,[30,0,[\"option\",\"icon\"]],[[[1,\"    \"],[8,[30,0,[\"option\",\"icon\"]],[[24,0,\"option-icon\"],[24,\"width\",\"16\"],[24,\"height\",\"16\"]],null,null],[1,\"\\n\"]],[]],null],[1,\"  \"],[10,1],[14,0,\"option-title\"],[15,\"data-test-enum-atom-unset\",[52,[30,0,[\"isUnsetFallback\"]],true,false]],[15,\"data-test-enum-atom-fallback\",[52,[30,0,[\"isValueFallback\"]],true,false]],[12],[1,\"\\n    \"],[1,[52,[30,0,[\"option\",\"label\"]],[30,0,[\"option\",\"label\"]],[30,0,[\"option\",\"value\"]]]],[1,\"\\n  \"],[13],[1,\"\\n\"]],[]],null]],[],[\"if\"]]",
          "moduleName": "packages/runtime-common/enum.gts",
          "isStrictMode": true
        }), this);
      }
    };
    static selectedItem = class SelectedItem extends GlimmerComponent {
      static {
        setComponentTemplate(createTemplateFactory(
        /*
          {{#if @option}}
          {{#let (component EnumField.atom) as |Atom|}}
            <Atom @model={{@option.value}} @configuration={{@configuration}} />
          {{/let}}
        {{/if}}
        */
        {
          "id": "IoAjoLPK",
          "block": "[[[41,[30,1],[[[44,[[50,[32,0,[\"atom\"]],0,null,null]],[[[1,\"    \"],[8,[30,2],null,[[\"@model\",\"@configuration\"],[[30,1,[\"value\"]],[30,3]]],null],[1,\"\\n\"]],[2]]]],[]],null]],[\"@option\",\"Atom\",\"@configuration\"],[\"if\",\"let\",\"component\"]]",
          "moduleName": "packages/runtime-common/enum.gts",
          "scope": () => [EnumField],
          "isStrictMode": true
        }), this);
      }
    };
    // CS-10787: render the matching option's label (not its raw value), so
    // enum fields read naturally in markdown output. Falls back to the
    // string form of the model when no option matches.
    static markdown = class Markdown extends GlimmerComponent {
      get text() {
        let v = this.args.model;
        if (v == null) {
          return '';
        }
        let cfg = this.args.configuration;
        let opts = normalizeEnumOptions(cfg?.enum?.options ?? []);
        let match = opts.find(o => isEqual(o.value, v));
        let display = match?.label ?? String(v);
        return markdownEscape(display);
      }
      static {
        setComponentTemplate(createTemplateFactory(
        /*
          {{this.text}}
        */
        {
          "id": "wviNiEOb",
          "block": "[[[1,[30,0,[\"text\"]]]],[],[]]",
          "moduleName": "packages/runtime-common/enum.gts",
          "isStrictMode": true
        }), this);
      }
    };
    static edit = class Edit extends GlimmerComponent {
      get options() {
        let cfg = this.args.configuration;
        let opts = cfg?.enum?.options ?? [];
        return normalizeEnumOptions(opts);
      }
      get hasExplicitNullOption() {
        return this.options.some(o => o?.value === null);
      }
      get placeholder() {
        if (this.args.model == null && !this.hasExplicitNullOption) {
          let cfg = this.args.configuration;
          return cfg?.enum?.unsetLabel ?? 'Choose…';
        }
        return undefined;
      }
      get selectedOption() {
        let opts = this.options;
        let found = opts.find(o => isEqual(o.value, this.args.model));
        return found === undefined ? undefined : found;
      }
      update = opt => {
        this.args.set?.(opt?.value ?? null);
      };
      static {
        setComponentTemplate(createTemplateFactory(
        /*
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
        */
        {
          "id": "9/v5eSNs",
          "block": "[[[8,[32,0],null,[[\"@options\",\"@selected\",\"@onChange\",\"@selectedItemComponent\",\"@disabled\",\"@renderInPlace\",\"@placeholder\"],[[30,0,[\"options\"]],[30,0,[\"selectedOption\"]],[30,0,[\"update\"]],[52,[30,0,[\"selectedOption\"]],[50,[32,1,[\"selectedItem\"]],0,null,[[\"configuration\"],[[30,1]]]]],[28,[32,2],[[30,2]],null],true,[30,0,[\"placeholder\"]]]],[[\"default\"],[[[[1,\"\\n\"],[44,[[50,[32,1,[\"atom\"]],0,null,null]],[[[1,\"    \"],[8,[30,4],null,[[\"@model\",\"@configuration\"],[[30,3,[\"value\"]],[30,1]]],null],[1,\"\\n\"]],[4]]]],[3]]]]]],[\"@configuration\",\"@canEdit\",\"opt\",\"Atom\"],[\"if\",\"component\",\"let\"]]",
          "moduleName": "packages/runtime-common/enum.gts",
          "scope": () => [BoxelSelect, EnumField, not],
          "isStrictMode": true
        }), this);
      }
    };
  }
  return EnumField;
}
export default enumField;