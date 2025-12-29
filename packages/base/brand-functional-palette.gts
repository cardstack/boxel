import { GridContainer, Swatch } from '@cardstack/boxel-ui/components';
import {
  buildCssVariableName,
  entriesToCssRuleMap,
} from '@cardstack/boxel-ui/helpers';

import { field, contains, Component, getFields, FieldDef } from './card-api';
import ColorField from './color';
import { dasherize, type CssRuleMap } from '@cardstack/boxel-ui/helpers';
import {
  type CssVariableField,
  type CssVariableFieldEntry,
} from './structured-theme-variables';

export const formatSwatchName = (name?: string) => {
  return dasherize(name).split('-').join(' ');
};

export default class BrandFunctionalPalette extends FieldDef {
  static displayName = 'Functional Palette';
  @field primary = contains(ColorField, {
    description: 'Primary CTA background-color.',
  });
  @field secondary = contains(ColorField, {
    description: 'Secondary CTA background-color.',
  });
  @field accent = contains(ColorField, {
    description: 'Accent background-color.',
  });
  @field light = contains(ColorField, {
    description: 'Light background-color.',
  });
  @field dark = contains(ColorField, {
    description: 'Dark background-color.',
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer class='functional-palette'>
        {{#each @model.cssVariableFields as |color|}}
          <Swatch
            @label={{formatSwatchName color.fieldName}}
            @color={{if color.value color.value '/* Not set */'}}
          />
        {{/each}}
      </GridContainer>
      <style scoped>
        .functional-palette {
          grid-template-columns: repeat(auto-fill, 7rem);
          gap: var(--boxel-sp-xl) var(--boxel-sp);
          align-items: end;
          text-wrap: pretty;
        }
        :deep(.boxel-swatch-name) {
          font-weight: 600;
          text-transform: capitalize;
        }
        :deep(.boxel-swatch-value) {
          text-transform: lowercase;
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
      let cssVariableName = buildCssVariableName(fieldName, {
        prefix: 'brand',
      });
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
