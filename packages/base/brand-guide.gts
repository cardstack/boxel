import {
  Component,
  CSSField,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
  type BaseDefComponent,
} from './card-api';
import ColorField from './color';
import StyleReference from './style-reference';
import {
  BoxelContainer,
  Swatch,
  Button,
  FieldContainer,
  GridContainer,
} from '@cardstack/boxel-ui/components';
import {
  buildCssGroups,
  entriesToCssRuleMap,
  generateCssVariables,
  getContrastColor,
} from '@cardstack/boxel-ui/helpers';

import BrandTypography from './brand-typography';
import BrandFunctionalPalette from './brand-functional-palette';
import BrandLogo from './brand-logo';
import CSSValueField from './css-value';
import ThemeVarField, { dasherize } from './structured-theme-variables';

const rootToBrandVariableMapping: Record<string, string> = {
  '--primary': '--brand-primary',
  '--secondary': '--brand-secondary',
  '--muted': '--brand-neutral',
  '--accent': '--brand-accent',
  '--background': '--brand-light',
  '--foreground': '--brand-dark',
  '--border': '--brand-border',
  '--primary-foreground': '--brand-primary-foreground',
  '--secondary-foreground': '--brand-secondary-foreground',
  '--muted-foreground': '--brand-neutral-foreground',
  '--accent-foreground': '--brand-accent-foreground',
  '--radius': '--brand-radius',
};

const brandForegroundMapping: string[] = [
  '--brand-primary-foreground',
  '--brand-secondary-foreground',
  '--brand-neutral-foreground',
  '--brand-accent-foreground',
];

class BrandGuideIsolated extends Component<typeof BrandGuide> {
  <template>
    <article class='brand-guide'>
      <BoxelContainer @tag='header' @display='flex' class='header-section'>
        {{#if @model.markUsage.primaryMark1}}
          <@fields.markUsage.primaryMark1 class='header-logo' />
        {{/if}}
        <h1><@fields.title /></h1>
        {{#if @model.description}}
          <p><@fields.description /></p>
        {{/if}}
      </BoxelContainer>
      <BoxelContainer @tag='section' @display='grid' class='content-section'>
        {{#if @model.brandColorPalette.length}}
          <h2>Brand Color Palette</h2>
          <@fields.brandColorPalette class='brand-palette' />
        {{/if}}
        <h2>Functional Palette</h2>
        <@fields.functionalPalette />
      </BoxelContainer>
      <BoxelContainer @tag='section' @display='grid' class='content-section'>
        <h2>Typography</h2>
        <@fields.typography />
      </BoxelContainer>
      <BoxelContainer @tag='section' @display='grid' class='content-section'>
        <h2>Mark Usage</h2>
        <@fields.markUsage />
      </BoxelContainer>
      <BoxelContainer @tag='section' @display='grid' class='content-section'>
        <h2>UI Components</h2>
        <GridContainer class='cta-grid'>
          <FieldContainer @label='Primary CTA' @vertical={{true}}>
            <div class='preview-container cta-preview-container'>
              <Button @kind='primary' @size='extra-small'>Sample CTA</Button>
            </div>
          </FieldContainer>
          <FieldContainer @label='Secondary CTA' @vertical={{true}}>
            <div class='preview-container cta-preview-container'>
              <Button @kind='secondary' @size='extra-small'>Sample CTA</Button>
            </div>
          </FieldContainer>
          <FieldContainer @label='Disabled CTA' @vertical={{true}}>
            <div class='preview-container cta-preview-container'>
              <Button @disabled={{true}} @size='extra-small'>Sample CTA</Button>
            </div>
          </FieldContainer>
        </GridContainer>
      </BoxelContainer>
      <BoxelContainer @tag='section' @display='grid' class='content-section'>
        <h2>Generated CSS Variables</h2>
        <@fields.cssVariables />
      </BoxelContainer>
    </article>

    <style scoped>
      h1,
      h2 {
        margin-block: 0;
        font-family: var(--boxel-heading-font-family);
        letter-spacing: var(--boxel-lsp-xs);
      }
      h1 {
        font-size: var(--boxel-heading-font-size);
        line-height: var(--boxel-heading-line-height);
      }
      h2 {
        font-size: var(--boxel-title-font-size);
        font-weight: 500;
        line-height: var(--boxel-title-line-height);
      }
      p {
        margin-block: 0;
      }
      .brand-guide {
        --brand-guide-border: 1px solid var(--border, var(--boxel-400));
        --brand-guide-spacing: var(--boxel-sp-xl);
        --boxel-container-padding: var(--brand-guide-spacing);
        height: 100%;
      }
      .header-section {
        min-height: 14rem; /* 224px */
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 0;
        background-color: var(--muted);
        color: var(--foreground);
      }
      .header-logo {
        --logo-min-height: var(--brand-primary-mark-min-height);
        margin: var(--boxel-sp);
      }
      .content-section {
        gap: var(--brand-guide-spacing);
      }
      .content-section + .content-section {
        border-top: var(--brand-guide-border);
      }
      .brand-palette {
        display: grid;
        grid-template-columns: repeat(auto-fill, 8rem);
        gap: var(--boxel-sp-xl) var(--boxel-sp);
        align-items: end;
        text-wrap: pretty;
      }
      .brand-palette + h2 {
        margin-top: var(--brand-guide-spacing);
      }
      .cta-grid {
        grid-template-columns: repeat(3, 1fr);
      }
      .preview-container {
        display: flex;
        align-items: center;
        justify-content: center;
        max-width: 100%;
        background-color: var(--muted, var(--boxel-100));
        color: var(--foreground, var(--boxel-dark));
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .cta-preview-container {
        min-height: 7.5rem;
      }
    </style>
  </template>
}

const formatCssVarName = (name?: string) => {
  let varName = dasherize(name);
  if (varName?.startsWith('--')) {
    varName = varName.replace(/^--/, '--brand-color-');
  } else {
    varName = `--brand-color-${varName}`;
  }
  return varName;
};

export class CompoundColorField extends FieldDef {
  static displayName = 'Color';
  @field name = contains(StringField);
  @field value = contains(ColorField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <Swatch @label={{formatCssVarName @model.name}} @color={{@model.value}} />
      <style scoped>
        :deep(.boxel-swatch-name) {
          font-weight: 600;
        }
      </style>
    </template>
  };
}

export default class BrandGuide extends StyleReference {
  static displayName = 'Brand Guide';

  private appendRules(
    source: Map<string, string> | undefined,
    target: Map<string, string>,
  ) {
    if (!source?.size) {
      return;
    }
    for (let [name, value] of source.entries()) {
      if (!name || !value || target.has(name)) {
        continue;
      }
      target.set(name, value);
    }
  }

  private calculateCombinedRules(
    cssVars?: ThemeVarField,
  ): Map<string, string> | undefined {
    let rootRules = cssVars?.cssRuleMap;
    let functionalRules = this.functionalPalette?.cssRuleMap;
    let combinedRules = rootRules
      ? new Map<string, string>(rootRules)
      : new Map<string, string>();

    let darkColor =
      functionalRules?.get('--brand-dark') ?? 'var(--boxel-dark, #000000)';
    let lightColor =
      functionalRules?.get('--brand-light') ?? 'var(--boxel-light, #ffffff)';

    for (let [rootName, brandName] of Object.entries(
      rootToBrandVariableMapping,
    )) {
      let rootValue = rootRules?.get(rootName);
      let paletteBrandValue = functionalRules?.get(brandName);
      let brandValue = paletteBrandValue ?? rootValue;

      if (!brandValue) {
        continue;
      }

      combinedRules.set(brandName, brandValue);
      combinedRules.set(rootName, `var(${brandName})`);

      let foregroundName = `${rootName}-foreground`;
      let brandForegroundName = `${brandName}-foreground`;

      if (!brandForegroundMapping.includes(brandForegroundName)) {
        continue;
      }

      let hasForegroundOverride =
        functionalRules?.has(brandForegroundName) ?? false;

      if (!hasForegroundOverride) {
        hasForegroundOverride = combinedRules.has(brandForegroundName);
      }

      if (!hasForegroundOverride) {
        let foregroundValue = getContrastColor(
          brandValue,
          darkColor,
          lightColor,
        );
        if (foregroundValue) {
          combinedRules.set(brandForegroundName, foregroundValue);
        }
      }

      if (combinedRules.has(brandForegroundName)) {
        combinedRules.set(foregroundName, `var(${brandForegroundName})`);
      }
    }

    this.appendRules(functionalRules, combinedRules);

    if (this.cornerRadius) {
      combinedRules.set('--brand-radius', this.cornerRadius);
    }

    if (this.spacing) {
      combinedRules.set('--brand-spacing', this.spacing);
      combinedRules.set('--spacing', `calc(var(--brand-spacing) / 4)`);
    }

    this.appendRules(this.typography?.cssRuleMap, combinedRules);
    this.appendRules(this.markUsage?.cssRuleMap, combinedRules);

    if (entriesToCssRuleMap && this.brandColorPalette?.length) {
      let paletteRules = entriesToCssRuleMap(this.brandColorPalette);
      for (let [name, value] of paletteRules.entries()) {
        if (!name || !value) {
          continue;
        }
        combinedRules.set(formatCssVarName(name), value);
      }
    }

    if (!combinedRules.size) {
      return;
    }

    return combinedRules;
  }

  // Color Palettes
  @field brandColorPalette = containsMany(CompoundColorField);
  @field functionalPalette = contains(BrandFunctionalPalette);
  @field typography = contains(BrandTypography);
  @field cornerRadius = contains(CSSValueField);
  @field spacing = contains(CSSValueField);
  @field markUsage = contains(BrandLogo);

  // CSS Variables computed from field entries
  @field cssVariables = contains(CSSField, {
    computeVia: function (this: BrandGuide) {
      if (!generateCssVariables || !buildCssGroups) {
        return;
      }
      let combinedRootRules = this.calculateCombinedRules(this.rootVariables);
      if (!combinedRootRules) {
        return;
      }
      return generateCssVariables(
        buildCssGroups([{ selector: ':root', rules: combinedRootRules }]),
      );
    },
  });

  static isolated: BaseDefComponent = BrandGuideIsolated;
}
