import {
  entriesToCssRuleMap,
  type CssVariableEntry,
} from '@cardstack/boxel-ui/helpers';

import {
  field,
  contains,
  getFields,
  FieldDef,
  type FieldsTypeFor,
} from './card-api';
import CSSValueField from './css-value';
import type { CssRuleMap } from '@cardstack/boxel-ui/helpers';
import { dasherize } from './structured-theme-variables';

type BrandTypographyKey = Exclude<
  keyof FieldsTypeFor<BrandTypography>,
  'constructor' | 'cssVariableFields' | 'cssRuleMap'
> &
  string;

interface CssVariableField extends CssVariableEntry {
  fieldName: BrandTypographyKey;
  cssVariableName: string;
}

export default class BrandTypography extends FieldDef {
  static displayName = 'Typography';

  @field headingFontFamily = contains(CSSValueField);
  @field headingFontSize = contains(CSSValueField);
  @field headingFontWeight = contains(CSSValueField);
  @field headingLineHeight = contains(CSSValueField);

  @field bodyFontFamily = contains(CSSValueField);
  @field bodyFontSize = contains(CSSValueField);
  @field bodyFontWeight = contains(CSSValueField);
  @field bodyLineHeight = contains(CSSValueField);

  get cssVariableFields(): CssVariableField[] | undefined {
    let fields = getFields(this);
    if (!fields) {
      return;
    }

    let fieldNames = Object.keys(fields) as BrandTypographyKey[];
    if (!fieldNames?.length) {
      return;
    }
    let cssVariableFields: CssVariableField[] = [];
    for (let fieldName of fieldNames) {
      let cssVariableName = `--brand-${dasherize(fieldName)}`;
      let value = this?.[fieldName];
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
