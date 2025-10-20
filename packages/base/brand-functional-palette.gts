import {
  GridContainer,
  FieldContainer,
  Swatch,
} from '@cardstack/boxel-ui/components';
import {
  entriesToCssRuleMap,
  type CssVariableEntry,
} from '@cardstack/boxel-ui/helpers';

import {
  field,
  contains,
  Component,
  getFields,
  FieldDef,
  type BoxComponent,
  type FieldsTypeFor,
} from './card-api';
import ColorField from './color';
import type { CssRuleMap } from '@cardstack/boxel-ui/helpers';
import { dasherize } from './structured-theme-variables';

type BrandFunctionalPaletteKeys = keyof FieldsTypeFor<BrandFunctionalPalette> &
  string;

interface CssVariableField extends CssVariableEntry {
  fieldName: BrandFunctionalPaletteKeys;
  cssVariableName: string;
  component?: BoxComponent;
}

export default class BrandFunctionalPalette extends FieldDef {
  static displayName = 'Functional Palette';
  @field primary = contains(ColorField);
  @field secondary = contains(ColorField);
  @field neutral = contains(ColorField);
  @field light = contains(ColorField);
  @field dark = contains(ColorField);
  @field accent = contains(ColorField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer class='functional-palette'>
        {{#each @model.cssVariableFields as |color|}}
          <FieldContainer
            class='functional-palette-item'
            @label={{color.name}}
            @vertical={{true}}
          >
            <Swatch @color={{color.value}} />
          </FieldContainer>
        {{/each}}
      </GridContainer>
      <style scoped>
        .functional-palette {
          grid-template-columns: repeat(auto-fill, 9rem);
          gap: var(--boxel-sp-xl) var(--boxel-sp);
        }
        .functional-palette-item {
          grid-template-rows: 1fr auto;
        }
      </style>
    </template>
  };

  get cssVariableFields(): CssVariableField[] | undefined {
    let fields = getFields(this);
    if (!fields) {
      return;
    }

    let fieldNames = Object.keys(fields) as BrandFunctionalPaletteKeys[];
    if (!fieldNames?.length) {
      return;
    }
    let cssVariableFields: CssVariableField[] = [];
    for (let fieldName of fieldNames) {
      let cssVariableName = `--brand-${dasherize(fieldName)}`;
      let value = this?.[fieldName] as string | undefined | null;
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
