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
  // getContrastColor,
  buildCssVariableName,
} from '@cardstack/boxel-ui/helpers';

import BrandTypography from './brand-typography';
import BrandFunctionalPalette from './brand-functional-palette';
import BrandLogo from './brand-logo';
import CSSValueField from './css-value';
import { mergeRuleMaps } from './structured-theme';
import { getContrastColor } from '@cardstack/boxel-ui/helpers';

const rootToBrandVariableMapping: Record<string, string> = {
  '--primary': '--brand-primary',
  '--secondary': '--brand-secondary',
  '--accent': '--brand-accent',
  '--background': '--brand-light',
  '--foreground': '--brand-dark',
  '--spacing': '--brand-spacing',
  '--radius': '--brand-radius',
};

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

export class CompoundColorField extends FieldDef {
  static displayName = 'Color';
  @field name = contains(StringField);
  @field value = contains(ColorField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <Swatch
        class='compound-color-swatch'
        @label={{@model.name}}
        @color={{@model.value}}
      />
      <style scoped>
        .compound-color-swatch {
          display: flex;
        }
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

  private calculateBrandRuleMap(): Map<string, string> | undefined {
    let brandRules = new Map<string, string>();

    // add brand functional palette variables
    this.appendRules(this.functionalPalette?.cssRuleMap, brandRules);

    // add brand custom palette variables
    if (entriesToCssRuleMap && this.brandColorPalette?.length) {
      let paletteRules = entriesToCssRuleMap(this.brandColorPalette);
      for (let [name, value] of paletteRules.entries()) {
        if (!name || !value) {
          continue;
        }
        brandRules.set(buildCssVariableName(name), value);
      }
    }

    // add brand typography variables
    this.appendRules(this.typography?.cssRuleMap, brandRules);

    // add brand mark variables
    this.appendRules(this.markUsage?.cssRuleMap, brandRules);

    if (!brandRules.size) {
      return;
    }

    return brandRules;
  }

  private calculatedRootRules(): Map<string, string> | undefined {
    let rootRules = this.rootVariables?.cssRuleMap;
    let functionalRules = this.functionalPalette?.cssRuleMap;
    let combinedRules = rootRules
      ? new Map<string, string>(rootRules)
      : new Map<string, string>();

    for (let [rootName, brandName] of Object.entries(
      rootToBrandVariableMapping,
    )) {
      let rootValue = rootRules?.get(rootName);
      let paletteBrandValue = functionalRules?.get(brandName);
      // if variable exists in root variables, use it, else use brand fallback
      // example: if a background variable is set, use that, else use `--brand-light` as background for light mode
      let calculatedValue = rootValue ?? paletteBrandValue;
      if (!calculatedValue) {
        continue;
      }
      combinedRules.set(rootName, calculatedValue);

      // set foreground variables
      if (['--primary', '--secondary', '--accent'].includes(rootName)) {
        let fgName = `${rootName}-foreground`;
        let rootFgValue = rootRules?.get(fgName);
        if (rootFgValue) {
          combinedRules.set(fgName, rootFgValue);
        } else {
          let fgValue = getContrastColor(
            calculatedValue,
            '#000000',
            '#ffffff',
            { isSmallText: true },
          );
          if (fgValue) {
            combinedRules.set(fgName, fgValue);
          }
        }
      }
    }

    let fontSans =
      rootRules?.get('--font-sans') ?? this.typography?.body?.fontFamily;
    if (fontSans) {
      combinedRules.set('--font-sans', fontSans);
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
      let brandRules = this.calculateBrandRuleMap();
      let calculatedRootRules = this.calculatedRootRules();
      let rootRules = mergeRuleMaps(calculatedRootRules, brandRules);
      let darkRules = mergeRuleMaps(
        this.darkModeVariables?.cssRuleMap,
        brandRules,
      );
      return generateCssVariables(
        buildCssGroups([
          { selector: ':root', rules: rootRules },
          { selector: '.dark', rules: darkRules },
        ]),
      );
    },
  });

  static isolated: BaseDefComponent = BrandGuideIsolated;
}
