import { tracked } from '@glimmer/tracking';
import { get } from '@ember/object';
import { modifier } from 'ember-modifier';
// @ts-ignore no types
import cssUrl from 'ember-css-url';
import {
  Component,
  CSSField,
  FieldDef,
  ImageDef,
  StringField,
  contains,
  containsMany,
  field,
  linksTo,
} from './card-api';
import ColorField from './color';
import {
  BasicFitted,
  CopyButton,
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
  sanitizeHtmlSafe,
  eq,
  CssVariableEntry,
} from '@cardstack/boxel-ui/helpers';

import { cardTypeDisplayName } from '@cardstack/runtime-common';

import BrandFunctionalPalette, {
  formatSwatchName,
} from './brand-functional-palette';
import BrandLogo from './brand-logo';
import { mergeRuleMaps } from './structured-theme';
import { ThemeTypographyField } from './structured-theme-variables';
import DetailedStyleRef from './detailed-style-reference';
import {
  ThemeDashboard,
  ThemeDashboardHeader,
  NavSection,
  ModeToggle,
  CssFieldEditor,
  CardContainerCss,
} from './default-templates/theme-dashboard';

const sharedBrandVarsMap: Record<string, string> = {
  '--primary': '--brand-primary',
  '--secondary': '--brand-secondary',
  '--accent': '--brand-accent',
};

const rootToBrandVariableMapping: Record<string, string> = {
  '--background': '--brand-light',
  '--foreground': '--brand-dark',
  ...sharedBrandVarsMap,
};

const darkToBrandVariableMapping: Record<string, string> = {
  '--background': '--brand-dark',
  '--foreground': '--brand-light',
  ...sharedBrandVarsMap,
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
          @version={{@model.version}}
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
            <NavSection
              @id={{section.id}}
              @title={{section.title}}
              data-test-brand-guide-section={{section.id}}
            >
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
              {{else if (eq section.id 'typography')}}
                <GridContainer class='typography-grid'>
                  {{#if @model.typography.heading}}
                    <div class='typography-block'>
                      <div class='typography-preview'>
                        <h1
                          style={{this.headingPreviewStyle}}
                          {{this.captureHeadingEl}}
                        >
                          {{#if @model.typography.heading.sampleText}}
                            {{@model.typography.heading.sampleText}}
                          {{else}}
                            The quick brown fox
                          {{/if}}
                        </h1>
                      </div>
                      <div class='typography-meta'>
                        <span class='typography-label'>Headline</span>
                        {{#if this.headingComputedStyles}}
                          <dl class='style-details'>
                            <dt>Family</dt>
                            <dd>{{this.headingComputedStyles.fontFamily}}</dd>
                            <dt>Size</dt>
                            <dd>{{this.headingComputedStyles.fontSize}}</dd>
                            <dt>Weight</dt>
                            <dd>{{this.headingComputedStyles.fontWeight}}</dd>
                            <dt>Line Height</dt>
                            <dd>{{this.headingComputedStyles.lineHeight}}</dd>
                          </dl>
                        {{/if}}
                      </div>
                    </div>
                  {{/if}}
                  {{#if @model.typography.body}}
                    <div class='typography-block'>
                      <div class='typography-preview'>
                        <p
                          style={{this.bodyPreviewStyle}}
                          {{this.captureBodyEl}}
                        >
                          {{#if @model.typography.body.sampleText}}
                            {{@model.typography.body.sampleText}}
                          {{else}}
                            The quick brown fox
                          {{/if}}
                        </p>
                      </div>
                      <div class='typography-meta'>
                        <span class='typography-label'>Body</span>
                        {{#if this.bodyComputedStyles}}
                          <dl class='style-details'>
                            <dt>Family</dt>
                            <dd>{{this.bodyComputedStyles.fontFamily}}</dd>
                            <dt>Size</dt>
                            <dd>{{this.bodyComputedStyles.fontSize}}</dd>
                            <dt>Weight</dt>
                            <dd>{{this.bodyComputedStyles.fontWeight}}</dd>
                            <dt>Line Height</dt>
                            <dd>{{this.bodyComputedStyles.lineHeight}}</dd>
                          </dl>
                        {{/if}}
                      </div>
                    </div>
                  {{/if}}
                </GridContainer>
                <@fields.typography class='brand-typography-preview' />
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
              {{else if (eq section.id 'card-container-css')}}
                {{#if @model.cssVariables}}
                  <CardContainerCss @cssVariables={{@model.cssVariables}} />
                  <hr class='brand-guide-vars-divider' />
                  <h3 class='brand-guide-vars-heading'>Brand Guide-Specific
                    Variables</h3>
                  <p class='brand-guide-vars-description'>These variables are
                    only available for Brand Guides. They are not available as
                    general Theme Card variables.</p>
                  <div class='brand-guide-vars-box'>
                    <h4 class='brand-guide-vars-title'>Functional Palette
                      Variables</h4>
                    <dl class='brand-guide-vars'>
                      <dt><code>--brand-primary</code></dt>
                      <dd>Primary brand color</dd>
                      <dt><code>--brand-secondary</code></dt>
                      <dd>Secondary brand color</dd>
                      <dt><code>--brand-accent</code></dt>
                      <dd>Accent brand color</dd>
                      <dt><code>--brand-light</code></dt>
                      <dd>Light brand color — used as
                        <code>--background</code>
                        in light mode and
                        <code>--foreground</code>
                        in dark mode</dd>
                      <dt><code>--brand-dark</code></dt>
                      <dd>Dark brand color — used as
                        <code>--foreground</code>
                        in light mode and
                        <code>--background</code>
                        in dark mode</dd>
                    </dl>
                  </div>
                  <div class='brand-guide-vars-box'>
                    <h4 class='brand-guide-vars-title'>Brand Mark Variables</h4>
                    <p class='brand-guide-vars-description'>These variables are
                      automatically set from your brand mark fields. Use them in
                      card CSS to reference the correct mark for the current
                      color scheme without manual light/dark switching.</p>
                    <dl class='brand-guide-vars'>
                      <dt><code>--brand-primary-mark</code></dt>
                      <dd>Primary mark URL —
                        <code>--brand-primary-mark-1</code>
                        in light mode,
                        <code>--brand-primary-mark-2</code>
                        in dark mode</dd>
                      <dt><code>--brand-secondary-mark</code></dt>
                      <dd>Secondary mark URL —
                        <code>--brand-secondary-mark-1</code>
                        in light mode,
                        <code>--brand-secondary-mark-2</code>
                        in dark mode</dd>
                      <dt><code>--brand-primary-mark-greyscale</code></dt>
                      <dd>Primary mark greyscale URL —
                        <code>--brand-primary-mark-greyscale-1</code>
                        in light mode,
                        <code>--brand-primary-mark-greyscale-2</code>
                        in dark mode</dd>
                      <dt><code>--brand-secondary-mark-greyscale</code></dt>
                      <dd>Secondary mark greyscale URL —
                        <code>--brand-secondary-mark-greyscale-1</code>
                        in light mode,
                        <code>--brand-secondary-mark-greyscale-2</code>
                        in dark mode</dd>
                      <dt><code>--brand-social-media-profile-icon</code></dt>
                      <dd>Social media profile icon URL</dd>
                      <dt><code>--brand-primary-mark-min-height</code></dt>
                      <dd>Minimum display height for the primary mark</dd>
                      <dt><code>--brand-primary-mark-clearance-ratio</code></dt>
                      <dd>Clear-space ratio around the primary mark (multiplied
                        by
                        <code>--brand-primary-mark-min-height</code>)</dd>
                      <dt><code>--brand-secondary-mark-min-height</code></dt>
                      <dd>Minimum display height for the secondary mark</dd>
                      <dt><code
                        >--brand-secondary-mark-clearance-ratio</code></dt>
                      <dd>Clear-space ratio around the secondary mark
                        (multiplied by
                        <code>--brand-secondary-mark-min-height</code>)</dd>
                    </dl>
                  </div>
                {{/if}}
              {{else if (eq section.id 'brand-image-attachments')}}
                <p class='brand-guide-vars-description'>Custom CSS variables for
                  image attachments:</p>
                <div class='brand-guide-vars-box brand-guide-custom-css-block'>
                  <CopyButton
                    class='brand-guide-custom-css-block-copy-button'
                    @textToCopy={{this.brandImageAttachmentCssBlock}}
                  />
                  <dl class='brand-guide-vars'>
                    {{#each this.brandImageAttachmentVarEntries as |entry|}}
                      <dt class='var-row' data-test-brand-image-attachment-var>
                        <code
                          data-test-brand-image-attachment-varname
                        >{{entry.varName}}</code>
                      </dt>
                      <dd
                        class='var-row brand-image-attachment-var-dd'
                        data-test-brand-image-attachment-url
                      >
                        <img
                          src={{entry.url}}
                          alt={{entry.altText}}
                          class='brand-image-attachment-thumb-mini'
                          data-test-brand-image-attachment-thumb
                        />
                        <code class='css-var-value'>url({{entry.url}})</code>
                      </dd>
                    {{/each}}
                  </dl>
                </div>
              {{else if (eq section.id 'custom-css')}}
                <p class='brand-guide-vars-description'>These variables are all
                  of the custom CSS properties for usage by this theme only.</p>
                <div class='brand-guide-vars-box brand-guide-custom-css-block'>
                  <CopyButton
                    class='brand-guide-custom-css-block-copy-button'
                    @textToCopy={{this.customCssVarsBlock}}
                  />
                  <dl class='brand-guide-vars'>
                    {{#each this.paletteVarEntries as |entry|}}
                      <dt class='var-row' data-test-brand-guide-palette-var>
                        <code
                          data-test-brand-guide-palette-var-name
                        >{{entry.varName}}</code>
                      </dt>
                      <dd
                        class='color-entry var-row'
                        data-test-brand-guide-palette-swatch
                      >
                        <Swatch
                          class='color-swatch-mini'
                          @color={{entry.color.value}}
                          @style='round'
                        />
                      </dd>
                    {{/each}}
                    {{#each this.customCssVarEntries as |entry|}}
                      <dt class='var-row' data-test-brand-guide-css-var>
                        <code
                          data-test-brand-guide-css-var-name
                        >{{entry.name}}</code>
                      </dt>
                      <dd class='var-row'>
                        <code
                          class='css-var-value'
                          data-test-brand-guide-css-var-value
                        >{{entry.value}}</code>
                      </dd>
                    {{/each}}
                    {{#each this.brandImageAttachmentVarEntries as |entry|}}
                      <dt
                        class='var-row'
                        data-test-brand-guide-image-attachment-var
                      >
                        <code
                          data-test-brand-guide-image-attachment-varname
                        >{{entry.varName}}</code>
                      </dt>
                      <dd
                        class='var-row brand-image-attachment-var-dd'
                        data-test-brand-guide-image-attachment-url
                      >
                        <img
                          src={{entry.url}}
                          alt={{entry.altText}}
                          class='brand-image-attachment-thumb-mini'
                        />
                        <code class='css-var-value'>url({{entry.url}})</code>
                      </dd>
                    {{/each}}
                  </dl>
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
        /* Pin tooltip colors so brand theme vars don't bleed into the overlay */
        --boxel-tooltip-background-color: rgb(0 0 0 / 85%);
        --boxel-tooltip-text-color: var(--boxel-light, #fff);
        --boxel-tooltip-border-color: transparent;
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

      /* typography section */
      .typography-grid {
        grid-template-columns: 1fr 1fr;
      }
      .typography-block {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        height: 100%;
      }
      .typography-preview {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        min-height: 11.25rem;
        background-color: var(--muted, var(--boxel-100));
        color: var(--foreground, var(--boxel-dark));
        border-radius: var(--boxel-border-radius);
        text-align: center;
        overflow: hidden;
        padding: var(--boxel-sp);
      }
      .typography-meta {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .typography-label {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted-foreground, var(--boxel-400));
      }
      .typography-preview h1,
      .typography-preview p {
        margin: 0;
      }
      .style-details {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 0.125rem var(--boxel-sp-sm);
        margin: 0;
        font-size: var(--boxel-font-size-xs);
      }
      .style-details dt {
        color: var(--muted-foreground, var(--boxel-400));
        font-weight: 500;
      }
      .style-details dd {
        margin: 0;
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
      }
      .brand-typography-preview {
        margin-top: var(--boxel-sp-xl);
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

      /* Brand Guide Variables */
      .brand-guide-vars-divider {
        border: none;
        border-top: 1px solid var(--dsr-border);
        margin-block: var(--boxel-sp-xl) 0;
      }
      .brand-guide-vars-heading {
        margin-top: var(--boxel-sp-lg);
      }
      .brand-guide-vars-box + .brand-guide-vars-box {
        margin-top: var(--boxel-sp);
      }
      .brand-guide-vars-box {
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
        border: 1px solid var(--dsr-border);
        margin-top: var(--boxel-sp-lg);
      }
      .brand-guide-vars-title {
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-block: 0 var(--boxel-sp-sm);
      }
      .brand-guide-vars-description {
        font-size: var(--boxel-font-size-sm);
        color: var(--dsr-muted-fg);
        margin-block: 0 var(--boxel-sp);
      }
      .brand-guide-vars {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--boxel-sp-xs) var(--boxel-sp-lg);
        font-size: var(--boxel-font-size-sm);
      }
      .brand-guide-vars dt {
        font-weight: 600;
      }
      .brand-guide-vars dd {
        margin: 0;
        color: var(--dsr-muted-fg);
      }
      .brand-guide-vars code {
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
        font-size: 0.9em;
      }

      /* Custom CSS / color variables section */
      .brand-guide-custom-css-block {
        position: relative;
      }
      .brand-guide-custom-css-block-copy-button {
        position: absolute;
        top: var(--boxel-sp-xs);
        right: var(--boxel-sp-xs);
      }
      .var-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .color-entry {
        display: flex;
        align-items: center;
      }
      .css-var-value {
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
        font-size: 0.9em;
        color: var(--dsr-muted-fg);
      }

      /* Attachments */
      .brand-image-attachment-var-dd {
        align-items: center;
        gap: var(--boxel-sp-sm);
        word-break: break-all;
      }
      .brand-image-attachment-thumb-mini {
        width: 2.5rem;
        height: 2.5rem;
        object-fit: cover;
        border-radius: var(--boxel-border-radius-sm);
        flex-shrink: 0;
        border: 1px solid var(--dsr-border);
      }
      .brand-image-attachment-vars {
        align-items: center;
      }
      /* Import CSS */
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
  @tracked private headingEl: Element | null = null;
  @tracked private bodyEl: Element | null = null;

  private captureHeadingEl = modifier((el: Element) => {
    this.headingEl = el;
    return () => {
      this.headingEl = null;
    };
  });

  private captureBodyEl = modifier((el: Element) => {
    this.bodyEl = el;
    return () => {
      this.bodyEl = null;
    };
  });

  private get headingComputedStyles() {
    void this.args.model.typography?.heading;
    let el = this.headingEl;
    if (!el) return null;
    let style = getComputedStyle(el);
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
    };
  }

  private get bodyComputedStyles() {
    void this.args.model.typography?.body;
    let el = this.bodyEl;
    if (!el) return null;
    let style = getComputedStyle(el);
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
    };
  }

  private get headingPreviewStyle() {
    let { fontFamily, fontSize, fontWeight, lineHeight } =
      this.args.model.typography?.heading ?? {};
    let styles: string[] = [];
    if (fontFamily) styles.push(`font-family: ${fontFamily}`);
    if (fontSize) styles.push(`font-size: ${fontSize}`);
    if (fontWeight) styles.push(`font-weight: ${fontWeight}`);
    if (lineHeight) styles.push(`line-height: ${lineHeight}`);
    return sanitizeHtmlSafe(styles.join('; '));
  }

  private get bodyPreviewStyle() {
    let { fontFamily, fontSize, fontWeight, lineHeight } =
      this.args.model.typography?.body ?? {};
    let styles: string[] = [];
    if (fontFamily) styles.push(`font-family: ${fontFamily}`);
    if (fontSize) styles.push(`font-size: ${fontSize}`);
    if (fontWeight) styles.push(`font-weight: ${fontWeight}`);
    if (lineHeight) styles.push(`line-height: ${lineHeight}`);
    return sanitizeHtmlSafe(styles.join('; '));
  }

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
      id: 'brand-image-attachments',
      navTitle: 'Image Attachments',
      title: 'Image Attachments',
    },
    {
      id: 'custom-css',
      navTitle: 'Custom CSS',
      title: 'Custom CSS Variables',
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

      if (section.id === 'card-container-css') {
        return Boolean(this.args.model.cssVariables);
      }

      if (section.id === 'custom-css') {
        return this.hasCustomVariables;
      }

      if (section.id === 'brand-image-attachments') {
        return Boolean(this.brandImageAttachmentVarEntries.length);
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

  private get paletteVarEntries() {
    if (!entriesToCssRuleMap || !this.args.model?.brandColorPalette?.length) {
      return [];
    }
    let paletteRules = entriesToCssRuleMap(
      this.args.model.brandColorPalette as any as CssVariableEntry[],
    );
    return this.args.model.brandColorPalette
      .filter((color) => color.name && color.value)
      .map((color) => ({
        color,
        varName: buildCssVariableName(color.name!),
        colorValue: paletteRules.get(color.name!) ?? '',
      }));
  }

  private get brandImageAttachmentCssBlock() {
    return this.brandImageAttachmentVarEntries
      .map((entry) => `${entry.varName}: url(${entry.url});`)
      .join('\n');
  }

  private get customCssVarsBlock() {
    let lines: string[] = [];
    if (entriesToCssRuleMap && this.args.model?.brandColorPalette?.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let paletteRules = entriesToCssRuleMap(
        this.args.model.brandColorPalette as any,
      );
      for (let [name, colorValue] of paletteRules.entries()) {
        lines.push(`${buildCssVariableName(name)}: ${colorValue};`);
      }
    }
    for (let cssVar of this.customCssVarEntries) {
      lines.push(`${cssVar.name}: ${cssVar.value};`);
    }
    for (let entry of this.brandImageAttachmentVarEntries) {
      lines.push(`${entry.varName}: url(${entry.url});`);
    }
    return lines.join('\n');
  }

  private get customCssVarEntries() {
    if (!entriesToCssRuleMap || !this.args.model?.customCssVariables?.length) {
      return [];
    }
    let rules = entriesToCssRuleMap(this.args.model?.customCssVariables);
    return [...rules.entries()].map(([name, value]) => ({
      name: buildCssVariableName(name),
      value,
    }));
  }

  private get brandImageAttachmentVarEntries() {
    return (this.args.model?.brandImageAttachments ?? [])
      .filter((item) => item.name?.trim() && item.image?.url)
      .map((item) => ({
        varName: buildCssVariableName(item.name!.trim()),
        url: item.image!.url!,
        altText: item.image!.name ?? '',
      }));
  }

  private get hasCustomVariables() {
    return Boolean(
      this.args.model?.brandColorPalette?.length ||
      this.customCssVarEntries.length ||
      this.brandImageAttachmentVarEntries.length,
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
      {{#if @model.value}}
        <Swatch
          class='compound-color-swatch'
          @label={{formatSwatchName @model.name}}
          @color={{@model.value}}
        />
      {{/if}}
      <style scoped>
        .compound-color-swatch {
          display: flex;
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

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='compound-color-edit'>
        <FieldContainer @label='Name' @vertical={{true}}>
          <@fields.name />
        </FieldContainer>
        <FieldContainer @label='Color' @vertical={{true}}>
          <@fields.value />
        </FieldContainer>
      </div>
      <style scoped>
        .compound-color-edit {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp-sm);
        }
      </style>
    </template>
  };
}

export class CustomCssVariable extends FieldDef {
  static displayName = 'Custom CSS Variable';
  @field name = contains(StringField);
  @field value = contains(StringField);

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='custom-css-variable-edit'>
        <FieldContainer @label='Variable Name' @vertical={{true}}>
          <@fields.name />
        </FieldContainer>
        <FieldContainer @label='Value' @vertical={{true}}>
          <@fields.value />
        </FieldContainer>
      </div>
      <style scoped>
        .custom-css-variable-edit {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp-sm);
        }
      </style>
    </template>
  };
}

export class CompoundImageField extends FieldDef {
  static displayName = 'Named Image';
  @field name = contains(StringField);
  @field image = linksTo(() => ImageDef);

  static embedded = class Embedded extends Component<
    typeof CompoundImageField
  > {
    <template>
      {{#if @model.image.url}}
        <figure
          class='brand-image-attachment-embedded'
          data-test-brand-image-attachment
        >
          <img
            src={{@model.image.url}}
            alt={{@model.image.name}}
            class='brand-image-attachment-thumb'
            data-test-brand-image-attachment-thumb
          />
          {{#if @model.name}}
            <figcaption
              class='brand-image-attachment-varname'
              data-test-brand-image-attachment-varname
            >
              <code>{{buildCssVariableName @model.name}}</code>
            </figcaption>
          {{/if}}
        </figure>
      {{/if}}
      <style scoped>
        .brand-image-attachment-embedded {
          margin: 0;
          border-radius: var(--boxel-border-radius);
          overflow: hidden;
          background-color: var(--dsr-card);
          border: 1px solid var(--dsr-border);
          display: flex;
          flex-direction: column;
        }
        .brand-image-attachment-thumb {
          width: 100%;
          aspect-ratio: 16 / 10;
          object-fit: cover;
          display: block;
        }
        .brand-image-attachment-varname {
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          font-size: var(--boxel-font-size-xs);
          color: var(--dsr-muted-fg);
        }
        .brand-image-attachment-varname code {
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
          font-size: 0.9em;
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof CompoundImageField> {
    <template>
      <div class='brand-image-attachment-edit'>
        <FieldContainer @label='Variable Name' @vertical={{true}}>
          <@fields.name />
        </FieldContainer>
        <FieldContainer @label='Image' @vertical={{true}}>
          <@fields.image />
        </FieldContainer>
      </div>
      <style scoped>
        .brand-image-attachment-edit {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp-sm);
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

    // add brand mark variables (exclude -1/-2 light/dark variants — these are
    // exposed only as mode-aware aliases, e.g. --brand-primary-mark)
    if (this.markUsage?.cssRuleMap?.size) {
      for (let [name, value] of this.markUsage.cssRuleMap.entries()) {
        if (!name || !value || brandRules.has(name) || /-(1|2)$/.test(name)) {
          continue;
        }
        brandRules.set(name, value);
      }
    }

    // add brand image attachment variables as url() references
    for (let item of this.brandImageAttachments ?? []) {
      let name = item.name?.trim();
      let url = item.image?.url;
      if (!name || !url) continue;
      let varName = buildCssVariableName(name);
      if (!brandRules.has(varName)) brandRules.set(varName, `url(${url})`);
    }

    // add custom CSS variables
    for (let cssVar of this.customCssVariables ?? []) {
      let name = cssVar.name?.trim();
      let value = cssVar.value?.trim();
      if (!name || !value) continue;
      let varName = buildCssVariableName(name);
      if (!brandRules.has(varName)) brandRules.set(varName, value);
    }

    if (!brandRules.size) {
      return;
    }

    return brandRules;
  }

  private calculatedRules(opts?: {
    darkMode: true;
  }): Map<string, string> | undefined {
    let rootRules = opts?.darkMode
      ? this.darkModeVariables?.cssRuleMap
      : this.rootVariables?.cssRuleMap;
    let functionalRules = this.functionalPalette?.cssRuleMap;
    let combinedRules = rootRules
      ? new Map<string, string>(rootRules)
      : new Map<string, string>();

    let variablesMap = opts?.darkMode
      ? darkToBrandVariableMapping
      : rootToBrandVariableMapping;
    for (let [rootName, brandName] of Object.entries(variablesMap)) {
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

  @field brandColorPalette = containsMany(CompoundColorField);
  @field functionalPalette = contains(BrandFunctionalPalette);
  @field typography = contains(ThemeTypographyField);
  @field markUsage = contains(BrandLogo);
  @field brandImageAttachments = containsMany(CompoundImageField);
  @field customCssVariables = containsMany(CustomCssVariable);

  // CSS Variables computed from field entries
  @field cssVariables = contains(CSSField, {
    computeVia: function (this: BrandGuide) {
      if (!generateCssVariables || !buildCssGroups) {
        return;
      }
      let brandRules = this.calculateBrandRuleMap();
      let markMap = this.markUsage?.cssRuleMap;
      const toUrlValue = (url?: string) => (url ? `url(${url})` : undefined);
      let rootMarkAliases = new Map(
        [
          [
            '--brand-primary-mark',
            toUrlValue(markMap?.get('--brand-primary-mark-1')),
          ],
          [
            '--brand-secondary-mark',
            toUrlValue(markMap?.get('--brand-secondary-mark-1')),
          ],
          [
            '--brand-primary-mark-greyscale',
            toUrlValue(markMap?.get('--brand-primary-mark-greyscale-1')),
          ],
          [
            '--brand-secondary-mark-greyscale',
            toUrlValue(markMap?.get('--brand-secondary-mark-greyscale-1')),
          ],
          [
            '--brand-social-media-profile-icon',
            toUrlValue(markMap?.get('--brand-social-media-profile-icon')),
          ],
        ].filter(([, v]) => v) as [string, string][],
      );
      let darkMarkAliases = new Map(
        [
          [
            '--brand-primary-mark',
            toUrlValue(
              markMap?.get('--brand-primary-mark-2') ??
                markMap?.get('--brand-primary-mark-1'),
            ),
          ],
          [
            '--brand-secondary-mark',
            toUrlValue(
              markMap?.get('--brand-secondary-mark-2') ??
                markMap?.get('--brand-secondary-mark-1'),
            ),
          ],
          [
            '--brand-primary-mark-greyscale',
            toUrlValue(
              markMap?.get('--brand-primary-mark-greyscale-2') ??
                markMap?.get('--brand-primary-mark-greyscale-1'),
            ),
          ],
          [
            '--brand-secondary-mark-greyscale',
            toUrlValue(
              markMap?.get('--brand-secondary-mark-greyscale-2') ??
                markMap?.get('--brand-secondary-mark-greyscale-1'),
            ),
          ],
          [
            '--brand-social-media-profile-icon',
            toUrlValue(markMap?.get('--brand-social-media-profile-icon')),
          ],
        ].filter(([, v]) => v) as [string, string][],
      );
      let rootRules = mergeRuleMaps(
        this.calculatedRules(),
        brandRules,
        rootMarkAliases,
      );
      let darkRules = mergeRuleMaps(
        this.calculatedRules({ darkMode: true }),
        brandRules,
        darkMarkAliases,
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
      let thumbnailURL =
        this.cardInfo?.cardThumbnail?.url ?? this.cardInfo?.cardThumbnailURL;
      return thumbnailURL?.length
        ? thumbnailURL
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
          aria-label={{if @model.cardThumbnailURL @model.cardTitle}}
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
