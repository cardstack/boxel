import { tracked } from '@glimmer/tracking';
import { get } from '@ember/object';
import cssUrl from 'ember-css-url';
import {
  Component,
  CSSField,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
} from './card-api';
import ColorField from './color';
import {
  BasicFitted,
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
  buildCssVariableName,
  eq,
} from '@cardstack/boxel-ui/helpers';

import { cardTypeDisplayName } from '@cardstack/runtime-common';

import BrandTypography from './brand-typography';
import BrandFunctionalPalette from './brand-functional-palette';
import BrandLogo from './brand-logo';
import CSSValueField from './css-value';
import { mergeRuleMaps } from './structured-theme';
import DetailedStyleRef from './detailed-style-reference';
import {
  ThemeDashboard,
  ThemeDashboardHeader,
  NavSection,
  ModeToggle,
  CssFieldEditor,
} from './default-templates/theme-dashboard';

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
    <ThemeDashboard
      class='brand-guide'
      style={{if this.isDarkMode @model.darkModeStyles}}
      @sections={{this.sectionsWithContent}}
      @isDarkMode={{this.isDarkMode}}
    >
      <:header>
        <ThemeDashboardHeader
          class='brand-guide-dashboard-header'
          @title={{@model.cardTitle}}
          @description={{@model.cardDescription}}
          @isDarkMode={{this.isDarkMode}}
        >
          <:meta>
            {{#if @model.markUsage.primaryMark1}}
              <figure class='header-logo-container'>
                {{#if this.isDarkMode}}
                  <@fields.markUsage.primaryMark2 class='header-logo' />
                {{else}}
                  <@fields.markUsage.primaryMark1 class='header-logo' />
                {{/if}}
              </figure>
            {{/if}}
          </:meta>
        </ThemeDashboardHeader>
      </:header>
      <:default>
        <ModeToggle
          class='brand-guide-mode-toggle'
          @toggleDarkMode={{this.toggleDarkMode}}
          @isDarkMode={{this.isDarkMode}}
        />
        <GridContainer class='brand-guide-grid'>
          {{#each this.sectionsWithContent as |section|}}
            <NavSection @id={{section.id}} @title={{section.title}}>
              {{#if (eq section.id 'brand-palette')}}
                <GridContainer>
                  {{#if @model.brandColorPalette.length}}
                    <h3>Brand Color Palette</h3>
                    <@fields.brandColorPalette class='brand-palette' />
                  {{/if}}
                  <h3>Functional Palette</h3>
                  <@fields.functionalPalette class='functional-palette' />
                  <h3 class='color-system-title'>Color System</h3>
                  <div class='color-system-container'>
                    {{#if this.isDarkMode}}
                      <@fields.darkModeVariables />
                    {{else}}
                      <@fields.rootVariables />
                    {{/if}}
                  </div>
                </GridContainer>
              {{else if (eq section.id 'ui-components')}}
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
                      <p>Lorem ipsum dolor sit amet, consectetur adipiscing
                        elit, sed do eiusmod tempor incididunt ut labore et
                        dolore magna aliqua. Ut enim ad minim veniam, quis
                        nostrud exercitation ullamco laboris nisi ut aliquip ex
                        ea commodo consequat. Duis aute irure dolor in
                        reprehenderit in voluptate velit esse cillum dolore eu
                        fugiat nulla pariatur. Excepteur sint occaecat cupidatat
                        non proident, sunt in culpa qui officia deserunt mollit
                        anim id est laborum.
                      </p>
                    </div>
                    <div
                      class='preview-container ui-preview-container photo-container'
                    />
                  </GridContainer>
                </FieldContainer>
              {{else if (eq section.id 'visual-dna')}}
                <div class='dsr-section-content'>
                  {{#if @model.colorPalette}}
                    <div class='subsection'>
                      <h3 class='subsection-title'>Color Palette</h3>
                      <div class='content-prose'>
                        <@fields.colorPalette />
                      </div>
                    </div>
                  {{/if}}

                  {{#if @model.typographySystem}}
                    <div class='dsr-subsection'>
                      <h3 class='dsr-subsection-title'>Typography System</h3>
                      <div class='dsr-content-prose'>
                        <@fields.typographySystem />
                      </div>
                    </div>
                  {{/if}}

                  {{#if @model.geometricLanguage}}
                    <div class='dsr-subsection'>
                      <h3 class='dsr-subsection-title'>Geometric Language</h3>
                      <div class='dsr-content-prose'>
                        <@fields.geometricLanguage />
                      </div>
                    </div>
                  {{/if}}

                  {{#if @model.materialVocabulary}}
                    <div class='dsr-subsection'>
                      <h3 class='dsr-subsection-title'>Material Vocabulary</h3>
                      <div class='dsr-content-prose'>
                        <@fields.materialVocabulary />
                      </div>
                    </div>
                  {{/if}}

                  {{#if @model.wallpaperImages.length}}
                    <div class='dsr-subsection'>
                      <h3 class='dsr-subsection-title'>Visual References</h3>
                      <div class='dsr-image-gallery'>
                        {{#each @model.wallpaperImages as |imageUrl|}}
                          <figure class='dsr-gallery-item'>
                            <img
                              src='{{imageUrl}}'
                              alt='Style reference'
                              class='dsr-gallery-image'
                            />
                          </figure>
                        {{/each}}
                      </div>
                    </div>
                  {{/if}}
                </div>
              {{else if (eq section.id 'import-css')}}
                <CssFieldEditor @setCss={{@model.setCss}} />
              {{else if (eq section.id 'inspirations')}}
                <div class='dsr-inspiration-tags'>
                  {{#each @model.inspirations as |inspiration|}}
                    <span class='dsr-inspiration-tag'>{{inspiration}}</span>
                  {{/each}}
                </div>
              {{else if section.fieldName}}
                {{#let (get @fields section.fieldName) as |FieldContent|}}
                  <div class='dsr-content-prose'>
                    {{! @glint-ignore }}
                    <FieldContent />
                  </div>
                {{/let}}
              {{/if}}
            </NavSection>
          {{/each}}
        </GridContainer>
      </:default>
    </ThemeDashboard>

    <style scoped>
      .brand-guide {
        --brand-guide-border: 1px solid var(--dsr-border);
        --brand-guide-spacing: var(--boxel-sp-xl);
        --boxel-container-padding: var(--brand-guide-spacing);
      }
      .brand-guide-dashboard-header {
        position: relative;
        text-align: center;
      }
      .brand-guide-mode-toggle {
        position: absolute;
        top: var(--boxel-sp);
        right: var(--boxel-sp);
      }
      .brand-guide-grid {
        gap: var(--boxel-sp-2xl);
      }
      .header-logo-container {
        display: flex;
        margin: 0 auto;
        width: 100%;
        max-width: 20rem;
        aspect-ratio: 1.8;
      }
      .header-logo {
        --logo-min-height: var(--brand-primary-mark-min-height);
        padding: var(--boxel-sp);
        height: auto;
        width: 100%;
      }
      .brand-palette {
        display: grid;
        grid-template-columns: repeat(auto-fill, 7rem);
        gap: var(--boxel-sp-xl) var(--boxel-sp);
        align-items: end;
        text-wrap: pretty;
      }
      .brand-palette :deep(.boxel-swatch-value),
      .functional-palette :deep(.boxel-swatch-value) {
        font-size: var(--boxel-font-size-xs);
      }
      .brand-palette + h3,
      .color-system-title {
        margin-top: var(--brand-guide-spacing);
      }
      .color-system-container {
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border-radius: var(--boxel-border-radius);
        padding: calc(var(--boxel-sp) * 2);
        border: 1px solid var(--dsr-border);
      }
      :deep(h3) {
        font-size: var(--boxel-font-size-md);
      }
      .cta-grid {
        margin-bottom: var(--boxel-sp-xl);
        grid-template-columns: repeat(3, 1fr);
      }
      .preview-container {
        display: flex;
        align-items: center;
        justify-content: center;
        max-width: 100%;
        background-color: var(--dsr-muted);
        color: var(--dsr-foreground);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .cta-preview-container {
        min-height: 7.5rem;
      }
      .ui-grid {
        grid-template-columns: repeat(2, 1fr);
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

      /* dsr styles */
      .dsr-section {
        margin-bottom: calc(var(--boxel-sp) * 4);
        scroll-margin-top: calc(var(--boxel-sp) * 6);
      }

      /* Subsections */
      .dsr-subsection {
        margin-bottom: calc(var(--boxel-sp) * 2.5);
      }
      .dsr-subsection:last-child {
        margin-bottom: 0;
      }
      .dsr-subsection-title {
        margin-bottom: var(--boxel-sp);
        color: var(--dsr-muted-fg);
      }

      /* Image Gallery */
      .dsr-image-gallery {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(17.5rem, 1fr));
        gap: calc(var(--boxel-sp) * 1.5);
        margin-top: calc(var(--boxel-sp) * 1.5);
      }
      .dsr-gallery-item {
        margin: 0;
        aspect-ratio: 16 / 10;
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border: 1px solid var(--dsr-border);
      }
      .dsr-gallery-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform var(--boxel-transition);
      }
      .dsr-gallery-item:hover .dsr-gallery-image {
        transform: scale(1.05);
      }

      /* Inspirations */
      .dsr-inspirations-section {
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border-radius: var(--boxel-border-radius);
        padding: calc(var(--boxel-sp) * 2);
        border: 1px solid var(--dsr-border);
      }
      .dsr-inspiration-tags {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--boxel-sp) * 0.5);
      }
      .dsr-inspiration-tag {
        display: inline-block;
        padding: calc(var(--boxel-sp) * 0.375) calc(var(--boxel-sp) * 0.75);
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border: 1px solid var(--dsr-border);
        border-radius: calc(var(--boxel-border-radius) * 0.5);
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
      }
      .dsr-inspiration-tag:hover {
        border-color: var(--dsr-fg);
      }

      /* Import Custom CSS */
      .css-textarea {
        --boxel-input-height: 19rem;
      }

      @media (max-width: 768px) {
        .dsr-image-gallery {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>

  @tracked private isDarkMode = false;

  private toggleDarkMode = () => {
    this.isDarkMode = !this.isDarkMode;
  };

  private sections = [
    {
      id: 'brand-palette',
      navTitle: 'Brand Palette',
      title: 'Brand Palette',
    },
    {
      id: 'typography',
      navTitle: 'Typography',
      title: 'Typography',
      fieldName: 'typography',
    },
    {
      id: 'mark-usage',
      navTitle: 'Mark Usage',
      title: 'Mark Usage',
      fieldName: 'markUsage',
    },
    {
      id: 'ui-components',
      navTitle: 'UI Components',
      title: 'UI Components',
    },
    ...(this.args.model?.guideSections ?? []),
  ];

  private get sectionsWithContent() {
    return this.sections.filter((section) => {
      let idsToInclude = ['ui-components', 'import-css', 'view-code'];

      if (idsToInclude.includes(section.id)) {
        return true;
      }

      if (section.id === 'brand-palette') {
        return this.hasBrandPaletteContent;
      }

      if (section.id === 'visual-dna') {
        return this.hasVisualDNAContent;
      }

      if (!section.fieldName) {
        return false;
      }

      let content = get(this.args.model ?? {}, section.fieldName);

      if (Array.isArray(content)) {
        return content.length > 0;
      }

      if (typeof content === 'string') {
        return content.trim().length > 0;
      }

      return Boolean(content);
    });
  }

  private get hasBrandPaletteContent() {
    return (
      this.args.model?.brandColorPalette?.length ||
      this.args.model?.functionalPalette?.cssVariableFields?.length
    );
  }

  private get hasVisualDNAContent() {
    let model = this.args.model;
    if (!model) {
      return false;
    }

    return Boolean(
      model.colorPalette ||
        model.typographySystem ||
        model.geometricLanguage ||
        model.materialVocabulary ||
        model.wallpaperImages?.length,
    );
  }
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

export default class BrandGuide extends DetailedStyleRef {
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

  @field cardThumbnailURL = contains(StringField, {
    computeVia: function (this: BrandGuide) {
      return this.cardInfo?.cardThumbnailURL?.length
        ? this.cardInfo?.cardThumbnailURL
        : this.markUsage?.socialMediaProfileIcon;
    },
  });

  static isolated = BrandGuideIsolated;
  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <BasicFitted
        @primary={{@model.cardTitle}}
        @secondary={{cardTypeDisplayName @model}}
        @description={{@model.cardDescription}}
      >
        <:thumbnail>
          {{#if @model.cardThumbnailURL}}
            <div
              class='brand-logo-thumbnail'
              style={{cssUrl 'background-image' @model.cardThumbnailURL}}
            />
          {{else}}
            <@model.constructor.icon
              data-test-card-type-icon
              class='card-type-icon'
            />
          {{/if}}
        </:thumbnail>
      </BasicFitted>

      <style scoped>
        .brand-logo-thumbnail {
          background-position: center;
          background-size: contain;
          background-repeat: no-repeat;
          border-radius: var(--boxel-border-radius-sm);
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
        .card-type-icon {
          padding: var(--boxel-sp-4xs);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <article class='brand-guide-embedded'>
        <div
          class='thumbnail-image'
          style={{if
            @model.cardThumbnailURL
            (cssUrl 'background-image' @model.cardThumbnailURL)
          }}
          role={{if @model.cardThumbnailURL 'img'}}
          alt={{if @model.cardThumbnailURL @model.cardTitle}}
        >
          {{#unless @model.cardThumbnailURL}}
            <@model.constructor.icon width='30' height='30' />
          {{/unless}}
        </div>
        <div class='content'>
          <h3><@fields.cardTitle /></h3>
          <p><@fields.cardDescription /></p>
        </div>
      </article>

      <style scoped>
        .brand-guide-embedded {
          height: 100%;
          display: grid;
          grid-template-columns: max-content 1fr;
          grid-template-rows: max-content;
          gap: var(--boxel-sp) var(--boxel-sp-lg);
          padding: var(--boxel-sp-lg);
          background-color: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          text-wrap: pretty;
        }
        .thumbnail-image {
          grid-column: 1;
          width: 4rem;
          height: 4rem;
          display: flex;
          align-items: center;
          justify-content: center;
          background-position: center;
          background-size: contain;
          background-repeat: no-repeat;
          border-radius: var(--boxel-border-radius-sm);
          border: 1px solid var(--border, var(--boxel-border-color));
          overflow: hidden;
        }
        .content {
          align-self: center;
        }
      </style>
    </template>
  };
}
