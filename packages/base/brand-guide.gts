import { tracked } from '@glimmer/tracking';
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
  Accordion,
  CopyButton,
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
import {
  dasherize,
  type CssVariableField,
  type CssVariableFieldEntry,
} from './structured-theme-variables';

// color helpers
const isHexColor = (value?: string) => {
  if (typeof value !== 'string') {
    return false;
  }
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
};

const contrastColor = (value?: string, fallback?: string) => {
  if (value && isHexColor(value) && getContrastColor) {
    return getContrastColor(
      value,
      'var(--boxel-dark, #0f172a)',
      'var(--boxel-light, #fdfdfc)',
      { isSmallText: true },
    );
  }
  return fallback;
};

const mixColor = (color?: string, mixWith?: string, percent = 0) => {
  if (!color || !mixWith || percent <= 0) {
    return color;
  }
  return `color-mix(in oklch, ${color}, ${mixWith} ${percent}%)`;
};

const lightenColor = (color?: string, percent = 10) =>
  mixColor(color, 'white', percent);

const darkenColor = (color?: string, percent = 10) =>
  mixColor(color, 'black', percent);

const DEFAULT_SPACING = '0.25rem';
const DEFAULT_RADIUS = '0.5rem';
const DEFAULT_DESTRUCTIVE = '#dc2626';
const DEFAULT_DESTRUCTIVE_FOREGROUND = '#ffffff';

const cssRuleMapFromRecord = (record?: CssVariableField) => {
  if (!entriesToCssRuleMap || !record) {
    return;
  }
  let entries: CssVariableFieldEntry[] = Object.entries(record)
    .filter(([, value]) => value != null && value !== '')
    .map(([fieldName, value]) => ({
      fieldName,
      cssVariableName: `--${dasherize(fieldName)}`,
      name: `--${dasherize(fieldName)}`,
      value,
    }));
  if (!entries.length) {
    return;
  }
  return entriesToCssRuleMap(entries);
};

class BrandGuideIsolated extends Component<typeof BrandGuide> {
  <template>
    <article class='brand-guide'>
      <BoxelContainer @tag='header' @display='flex' class='header-section'>
        {{#if @model.markUsage.primaryMark1}}
          <figure class='header-logo-container'>
            <@fields.markUsage.primaryMark1 class='header-logo' />
          </figure>
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
        <FieldContainer
          @label='Corner Radius for holding shapes'
          @vertical={{true}}
        >
          <GridContainer class='ui-grid'>
            <div class='preview-container ui-preview-container'>
              <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
                eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut
                enim ad minim veniam, quis nostrud exercitation ullamco laboris
                nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor
                in reprehenderit in voluptate velit esse cillum dolore eu fugiat
                nulla pariatur. Excepteur sint occaecat cupidatat non proident,
                sunt in culpa qui officia deserunt mollit anim id est laborum.
              </p>
            </div>
            <div
              class='preview-container ui-preview-container photo-container'
            />
          </GridContainer>
        </FieldContainer>
      </BoxelContainer>
      <BoxelContainer
        @tag='section'
        @display='grid'
        class='content-section accordion-section'
      >
        <Accordion as |A|>
          <A.Item
            @isOpen={{this.isGeneratedCSSVisible}}
            @onClick={{this.toggleGeneratedCSS}}
            @id='generated-css-content'
          >
            <:title><span class='accordion-title'>Generated CSS Variables</span></:title>
            <:content>
              <div class='accordion-content generated-css-content'>
                <CopyButton
                  class='copy-css-variables-button'
                  @textToCopy={{@model.cssVariables}}
                />
                <div class='generated-css'>
                  <@fields.cssVariables />
                </div>
              </div>
            </:content>
          </A.Item>
          <A.Item
            @isOpen={{this.areCSSImportsVisible}}
            @onClick={{this.toggleCSSImports}}
            @id='css-imports-content'
          >
            <:title><span class='accordion-title'>CSS Imports</span></:title>
            <:content>
              <div class='accordion-content'>
                {{#if @model.cssImports}}
                  <@fields.cssImports />
                {{else}}
                  <em>None</em>
                {{/if}}
              </div>
            </:content>
          </A.Item>
        </Accordion>
      </BoxelContainer>
    </article>

    <style scoped>
      h1,
      h2 {
        margin-block: 0;
        font-family: var(--brand-heading-font-family, var(--boxel-font-family));
        font-weight: var(
          --brand-heading-font-weight,
          var(--boxel-font-weight-semibold)
        );
        letter-spacing: var(--boxel-lsp-xs);
      }
      h1 {
        font-size: var(--brand-heading-font-size, var(--boxel-font-size-med));
        line-height: var(
          --brand-heading-line-height,
          var(--boxel-lineheight-med)
        );
      }
      h2 {
        font-size: var(--boxel-font-size-med);
        line-height: var(--boxel-lineheight-med);
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
      .header-logo-container {
        display: flex;
        margin: 0;
        width: 100%;
        max-width: 28.125rem;
        aspect-ratio: 1.8;
      }
      .header-logo {
        --logo-min-height: var(--brand-primary-mark-min-height);
        padding: var(--boxel-sp);
        height: auto;
        width: 100%;
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
      .ui-grid {
        grid-template-columns: repeat(2, 1fr);
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
      .ui-preview-container {
        height: 11.25rem;
        align-items: flex-start;
        padding: var(--boxel-sp-xxl);
        overflow: auto;
      }
      .photo-container {
        background-image: url('https://app-assets-cardstack.s3.us-east-1.amazonaws.com/%40cardstack/boxel/images/placeholders/photo-placeholder.png');
        background-position: center;
        background-repeat: no-repeat;
        background-size: cover;
      }

      .accordion-section {
        padding-inline: 0;
      }
      .accordion-title {
        font-size: var(--boxel-font-size-med);
        line-height: var(--boxel-lineheight-med);
        font-weight: var(--boxel-font-weight-medium);
      }
      :deep(.boxel-accordion-item) {
        padding-inline: var(--boxel-container-padding, var(--boxel-sp));
      }
      .accordion-content {
        padding-bottom: var(--boxel-sp);
      }
      .generated-css-content {
        position: relative;
      }
      .copy-css-variables-button {
        position: absolute;
        top: var(--boxel-sp-xs);
        right: var(--boxel-sp-xs);
        opacity: 0.5;
      }
      .copy-css-variables-button:hover {
        opacity: 1;
      }
      .generated-css {
        height: 50cqmin;
        border-radius: var(--radius);
        overflow: auto;
      }
    </style>
  </template>

  @tracked areCSSImportsVisible = false;
  @tracked isGeneratedCSSVisible = false;

  private toggleCSSImports = () => {
    this.areCSSImportsVisible = !this.areCSSImportsVisible;
  };

  private toggleGeneratedCSS = () => {
    this.isGeneratedCSSVisible = !this.isGeneratedCSSVisible;
  };
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
      <Swatch @label={{@model.name}} @color={{@model.value}} />
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

  private calculateBrandRules(): Map<string, string> | undefined {
    let brandRules = new Map<string, string>();

    this.appendRules(this.functionalPalette?.cssRuleMap, brandRules);

    if (this.cornerRadius) {
      brandRules.set('--brand-radius', this.cornerRadius);
    }

    if (this.spacing) {
      brandRules.set('--brand-spacing', this.spacing);
    }

    this.appendRules(this.typography?.cssRuleMap, brandRules);
    // this.appendHeadingTypeScale(brandRules);
    // this.appendBodyTypeScale(brandRules);
    this.appendRules(this.markUsage?.cssRuleMap, brandRules);

    if (entriesToCssRuleMap && this.brandColorPalette?.length) {
      let paletteRules = entriesToCssRuleMap(this.brandColorPalette);
      for (let [name, value] of paletteRules.entries()) {
        if (!name || !value) {
          continue;
        }
        brandRules.set(formatCssVarName(name), value);
      }
    }

    if (!brandRules.size) {
      return;
    }

    return brandRules;
  }

  private generateThemeVariables(
    mode: 'light' | 'dark' = 'light',
  ): CssVariableField | undefined {
    let palette = this.functionalPalette;
    let typography = this.typography;
    let values: CssVariableField = {};
    let setValue = (key: string, value?: string | null) => {
      if (value) {
        values[key] = value;
      }
    };

    let background = mode === 'light' ? palette?.light : palette?.dark;
    let foreground = mode === 'light' ? palette?.dark : palette?.light;

    let neutralSurface =
      palette?.neutral ??
      (mode === 'light'
        ? darkenColor(background, 8)
        : lightenColor(background, 14));

    let popoverSurface =
      mode === 'light'
        ? darkenColor(neutralSurface, 4) ?? neutralSurface
        : lightenColor(neutralSurface, 10) ?? neutralSurface;

    let primary = palette?.primary ?? palette?.accent;
    let secondary = palette?.secondary ?? palette?.accent;
    let accent = palette?.accent ?? secondary;
    let muted =
      neutralSurface ??
      (mode === 'light'
        ? lightenColor(background, 4)
        : darkenColor(background, 6));
    let border =
      palette?.border ??
      (mode === 'light' ? darkenColor(muted, 15) : lightenColor(muted, 18));
    let ring = primary;

    setValue('background', background);
    setValue('foreground', foreground);
    setValue('card', neutralSurface);
    setValue('cardForeground', contrastColor(neutralSurface, foreground));
    setValue('popover', popoverSurface);
    setValue('popoverForeground', contrastColor(popoverSurface, foreground));
    setValue('primary', primary);
    setValue('primaryForeground', contrastColor(primary, foreground));
    setValue('secondary', secondary);
    setValue('secondaryForeground', contrastColor(secondary, foreground));
    setValue('accent', accent);
    setValue('accentForeground', contrastColor(accent, foreground));
    setValue('muted', muted);
    setValue('mutedForeground', contrastColor(muted, foreground));
    setValue('border', border);
    setValue('input', border);
    setValue('ring', ring);
    setValue('destructive', DEFAULT_DESTRUCTIVE);
    setValue('destructiveForeground', DEFAULT_DESTRUCTIVE_FOREGROUND);

    let sidebar =
      mode === 'light'
        ? palette?.neutral ?? neutralSurface
        : darkenColor(background, 8) ?? palette?.neutral ?? neutralSurface;
    setValue('sidebar', sidebar);
    setValue('sidebarForeground', contrastColor(sidebar, foreground));
    setValue('sidebarPrimary', primary);
    setValue('sidebarPrimaryForeground', contrastColor(primary, foreground));
    setValue('sidebarAccent', secondary);
    setValue('sidebarAccentForeground', contrastColor(secondary, foreground));
    setValue('sidebarBorder', border);
    setValue('sidebarRing', ring);

    let chartSources = this.brandColorPalette ?? [];
    for (let index = 0; index < 5; index++) {
      let chartColor = chartSources[index]?.value;
      setValue(`chart${index + 1}`, chartColor);
    }

    let fontSans =
      typography?.body?.fontFamily ?? typography?.heading?.fontFamily;

    setValue('fontSans', fontSans);

    setValue('radius', this.cornerRadius ?? DEFAULT_RADIUS);
    setValue('spacing', this.spacing ?? DEFAULT_SPACING);

    return Object.keys(values).length ? values : undefined;
  }

  private get generatedRootCssRuleMap() {
    const generatedRootTheme = this.generateThemeVariables('light');
    return cssRuleMapFromRecord(generatedRootTheme);
  }

  private get generatedDarkCssRuleMap() {
    const generatedDarkTheme = this.generateThemeVariables('dark');
    return cssRuleMapFromRecord(generatedDarkTheme);
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
      let rootRuleMap = this.rootVariables?.cssRuleMap;
      let darkRuleMap = this.darkModeVariables?.cssRuleMap;
      let rootRules = rootRuleMap?.size
        ? rootRuleMap
        : this.generatedRootCssRuleMap;
      let darkRules = darkRuleMap?.size
        ? darkRuleMap
        : this.generatedDarkCssRuleMap;
      let brandRules = this.calculateBrandRules();
      let sections: string[] = [];

      if (rootRules?.size) {
        let shadcnCss = generateCssVariables(
          buildCssGroups([{ selector: ':root', rules: rootRules }]),
        );
        if (shadcnCss) {
          sections.push(shadcnCss);
        }
      }

      if (darkRules?.size) {
        let darkCss = generateCssVariables(
          buildCssGroups([{ selector: '.dark', rules: darkRules }]),
        );
        if (darkCss) {
          sections.push(darkCss);
        }
      }

      if (brandRules?.size) {
        let brandCss = generateCssVariables(
          buildCssGroups([{ selector: ':root', rules: brandRules }]),
        );
        if (brandCss) {
          sections.push(`/* Brand Variables */\n${brandCss}`);
        }
      }

      if (!sections.length) {
        return;
      }

      return sections.join('\n\n');
    },
  });

  static isolated: BaseDefComponent = BrandGuideIsolated;
}
