import { GridContainer, Swatch } from '@cardstack/boxel-ui/components';
import { entriesToCssRuleMap } from '@cardstack/boxel-ui/helpers';

import { field, contains, Component, getFields, FieldDef } from './card-api';
import ColorField from './color';
import type { CssRuleMap } from '@cardstack/boxel-ui/helpers';
import {
  dasherize,
  type CssVariableField,
  type CssVariableFieldEntry,
} from './structured-theme-variables';

export default class BrandFunctionalPalette extends FieldDef {
  static displayName = 'Functional Palette';
  @field primary = contains(ColorField);
  @field secondary = contains(ColorField);
  @field neutral = contains(ColorField);
  @field border = contains(ColorField);
  @field accent = contains(ColorField);
  @field dark = contains(ColorField);
  @field light = contains(ColorField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer class='functional-palette'>
        {{#each @model.cssVariableFields as |color|}}
          {{#if color.value}}
            <Swatch @label={{color.fieldName}} @color={{color.value}} />
          {{/if}}
        {{/each}}
      </GridContainer>
      <style scoped>
        .functional-palette {
          grid-template-columns: repeat(auto-fill, 8rem);
          gap: var(--boxel-sp-xl) var(--boxel-sp);
          align-items: end;
          text-wrap: pretty;
        }
        :deep(.boxel-swatch-name) {
          font-weight: 600;
          text-transform: capitalize;
        }
      </style>
    </template>
  };

  get cssVariableFields(): CssVariableFieldEntry[] | undefined {
    let fields = getFields(this);
    if (!fields) {
      return;
    }

    let fieldNames = Object.keys(fields);
    if (!fieldNames?.length) {
      return;
    }
    let cssVariableFields: CssVariableFieldEntry[] = [];
    for (let fieldName of fieldNames) {
      let cssVariableName = `--brand-${dasherize(fieldName)}`;
      let value = (this as CssVariableField)?.[fieldName];
      cssVariableFields.push({
        fieldName,
        cssVariableName,
        name: cssVariableName,
        value,
      });
    }
    return cssVariableFields;
  }

  get cssRuleMap(): CssRuleMap | undefined {
    if (!entriesToCssRuleMap) {
      return;
    }
    return entriesToCssRuleMap(this.cssVariableFields);
  }
}
