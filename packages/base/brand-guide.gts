// import GlimmerComponent from '@glimmer/component';
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
  // FieldContainer,
  // GridContainer,
  Swatch,
} from '@cardstack/boxel-ui/components';
import {
  buildCssGroups,
  entriesToCssRuleMap,
  generateCssVariables,
  getContrastColor,
} from '@cardstack/boxel-ui/helpers';

import BrandTypography from './brand-typography';
import BrandFunctionalPalette from './brand-functional-palette';
import { dasherize } from './structured-theme-variables';

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
        <h1><@fields.title /></h1>
        {{#if @model.description}}
          <p><@fields.description /></p>
        {{/if}}
      </BoxelContainer>
      <BoxelContainer
        @tag='section'
        @display='grid'
        class='content-section color-palette-section'
      >
        {{#if @model.brandColorPalette.length}}
          <h2>Brand Color Palette</h2>
          <@fields.brandColorPalette class='brand-palette' />
        {{/if}}
        <h2>Functional Palette</h2>
        <@fields.functionalPalette />
      </BoxelContainer>
      <@fields.cssVariables />
    </article>
    <style scoped>
      h1,
      h2 {
        margin-block: 0;
        font-family: var(--brand-heading-font-family, var(--boxel-font-family));
        font-size: var(--brand-heading-font-size, var(--boxel-font-size-med));
        font-weight: var(
          --brand-heading-font-weight,
          var(--boxel-font-weight-semibold)
        );
        letter-spacing: var(--boxel-lsp-xs);
        line-height: var(--brand-heading-line-height, calc(28 / 20));
      }
      p {
        margin-block: 0;
      }
      .brand-guide {
        --annotation: rgba(255 0 0 / 0.15);
        --annotation-foreground: rgb(255 0 0);
        --boxel-container-padding: var(--boxel-sp-xxl);
        --container-border: 1px solid
          color-mix(
            in oklab,
            var(--border, var(--muted, var(--boxel-100))) 90%,
            var(--foreground, var(--boxel-dark))
          );
        height: 100%;
      }
      .header-section {
        min-height: 14rem; /* 224px */
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 0;
        background-color: var(--muted);
        color: var(--muted-foreground);
      }
      .content-section + .content-section {
        border-top: var(--boxel-border);
      }
      .brand-palette {
        display: grid;
        grid-template-columns: repeat(auto-fill, 8rem);
        gap: var(--boxel-sp-xl) var(--boxel-sp);
        align-items: end;
        text-wrap: pretty;
      }
      .brand-palette + h2 {
        margin-top: var(--boxel-sp-xl);
      }
      .preview-field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .preview-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
      .container-group {
        --boxel-container-padding: 0;
        gap: 0;
      }
      .container-group > * + * {
        border-left: var(--container-border);
      }
      .grayscale {
        filter: grayscale(1);
      }
      .media-handle-group {
        gap: var(--boxel-sp-xs);
      }
      .media-handle {
        font-weight: var(--boxel-font-weight-semibold);
      }
      .mark-clearance {
        min-width: initial;
        border-color: var(--annotation);
        border-style: solid;
        border-width: var(--mark-clearance, 0px);
        box-sizing: content-box;
      }
      .primary-clearance {
        --mark-clearance: var(--logo-primary-clearance);
      }
      .secondary-clearance {
        --mark-clearance: var(--logo-secondary-clearance);
      }
      .annotation {
        color: var(--annotation-foreground);
        font-weight: var(--boxel-font-weight-bold);
        white-space: nowrap;
      }
      .mark-height {
        min-width: initial;
        padding-left: var(--boxel-sp-xs);
        border-left: 4px solid var(--annotation);
      }
      .primary-height {
        --logo-min-height: var(--logo-primary-min-height);
      }
      .secondary-height {
        --logo-min-height: var(--logo-secondary-min-height);
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

  // Color Palettes
  @field brandColorPalette = containsMany(CompoundColorField);
  @field functionalPalette = contains(BrandFunctionalPalette);
  @field typography = contains(BrandTypography);

  // CSS Variables computed from field entries
  @field cssVariables = contains(CSSField, {
    computeVia: function (this: BrandGuide) {
      if (!generateCssVariables || !buildCssGroups) {
        return;
      }
      let rootRules = this.rootVariables?.cssRuleMap;
      let functionalRules = this.functionalPalette?.cssRuleMap;
      let combinedRootRules = rootRules
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

        if (brandValue) {
          combinedRootRules.set(brandName, brandValue);
          combinedRootRules.set(rootName, `var(${brandName})`);

          let foregroundName = `${rootName}-foreground`;
          let brandForegroundName = `${brandName}-foreground`;
          if (brandForegroundMapping.includes(brandForegroundName)) {
            let hasForegroundOverride =
              functionalRules?.has(brandForegroundName) ?? false;

            if (!hasForegroundOverride) {
              hasForegroundOverride =
                combinedRootRules.has(brandForegroundName);
            }

            if (!hasForegroundOverride) {
              let foregroundValue = getContrastColor(
                brandValue,
                darkColor,
                lightColor,
              );
              if (foregroundValue) {
                combinedRootRules.set(brandForegroundName, foregroundValue);
              }
            }

            if (combinedRootRules.has(brandForegroundName)) {
              combinedRootRules.set(
                foregroundName,
                `var(${brandForegroundName})`,
              );
            }
          }
        }
      }

      if (functionalRules?.size) {
        for (let [name, value] of functionalRules.entries()) {
          if (!name || !value || combinedRootRules.has(name)) {
            continue;
          }
          combinedRootRules.set(name, value);
        }
      }

      if (entriesToCssRuleMap && this.brandColorPalette?.length) {
        let paletteRules = entriesToCssRuleMap(this.brandColorPalette);
        for (let [name, value] of paletteRules.entries()) {
          if (name && value) {
            combinedRootRules.set(formatCssVarName(name), value);
          }
        }
      }

      if (!combinedRootRules.size) {
        return;
      }

      return generateCssVariables(
        buildCssGroups([{ selector: ':root', rules: combinedRootRules }]),
      );
    },
  });

  static isolated: BaseDefComponent = BrandGuideIsolated;
}
