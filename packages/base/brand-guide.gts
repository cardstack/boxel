import GlimmerComponent from '@glimmer/component';
import { concat } from '@ember/helper';
import { startCase } from 'lodash';
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
import URLField from './url';
import StyleReference from './style-reference';
import {
  BoxelContainer,
  FieldContainer,
  GridContainer,
  Swatch,
} from '@cardstack/boxel-ui/components';
import {
  cn,
  cssVar,
  sanitizeHtmlSafe,
  getContrastColor,
} from '@cardstack/boxel-ui/helpers';
import { getField } from '@cardstack/runtime-common';

class BrandGuideIsolated extends Component<typeof BrandGuide> {
  <template>
    <article class='brand-guide'>
      <BoxelContainer
        @tag='header'
        @display='flex'
        class='header-section'
        style={{cssVar
          primary-foreground=(getContrastColor
            @model.functionalPalette.primary
            @model.headline.color
            @model.functionalPalette.light
          )
        }}
      >
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
          <PaletteComponent @colors={{@model.brandColorPalette}} />
        {{/if}}
        <h2>Functional Palette</h2>
        <@fields.functionalPalette />
      </BoxelContainer>

      <BoxelContainer
        @tag='section'
        @display='grid'
        class='content-section mark-usage-section'
      >
        <h2>Mark Usage</h2>
        <FieldContainer @label='Clearance Area' @vertical={{true}}>
          <div class='preview-field'>
            <p>Scales in proportion to size of logo used</p>
            <PreviewContainer class='preview-grid container-group'>
              <PreviewContainer @hideBoundaries={{true}} @radius='none'>
                <@fields.primaryMark1
                  class='mark-clearance primary-clearance'
                />
              </PreviewContainer>
              <PreviewContainer @hideBoundaries={{true}} @radius='none'>
                <@fields.secondaryMark1
                  class='mark-clearance secondary-clearance'
                />
              </PreviewContainer>
            </PreviewContainer>
          </div>
        </FieldContainer>
        {{! minimum size }}
        <FieldContainer @label='Minimum Size' @vertical={{true}}>
          <div class='preview-field'>
            <p>For screen use</p>
            <PreviewContainer class='preview-grid container-group'>
              <PreviewContainer @hideBoundaries={{true}} @radius='none'>
                <span class='annotation'><@fields.primaryMarkMinHeight /></span>
                <@fields.primaryMark1 class='mark-height primary-height' />
              </PreviewContainer>
              <PreviewContainer @hideBoundaries={{true}} @radius='none'>
                <span class='annotation'>
                  <@fields.secondaryMarkMinHeight />
                </span>
                <@fields.secondaryMark1 class='mark-height secondary-height' />
              </PreviewContainer>
            </PreviewContainer>
          </div>
        </FieldContainer>
        {{! primary mark }}
        <GridContainer class='preview-grid'>
          <FieldContainer @label='Primary Mark 1' @vertical={{true}}>
            <div class='preview-field'>
              {{#let (getField @model 'primaryMark1') as |f|}}
                <p>{{f.description}}</p>
              {{/let}}
              <PreviewContainer>
                <@fields.primaryMark1 />
              </PreviewContainer>
            </div>
          </FieldContainer>
          <FieldContainer @label='Primary Mark 2' @vertical={{true}}>
            <div class='preview-field'>
              {{#let (getField @model 'primaryMark2') as |f|}}
                <p>{{f.description}}</p>
              {{/let}}
              <PreviewContainer @variant='primary'>
                <@fields.primaryMark2 />
              </PreviewContainer>
            </div>
          </FieldContainer>
        </GridContainer>
        {{! secondary mark }}
        <GridContainer class='preview-grid'>
          <FieldContainer @label='Secondary Mark 1' @vertical={{true}}>
            <div class='preview-field'>
              {{#let (getField @model 'secondaryMark1') as |f|}}
                <p>{{f.description}}</p>
              {{/let}}
              <PreviewContainer>
                <@fields.secondaryMark1 />
              </PreviewContainer>
            </div>
          </FieldContainer>
          <FieldContainer @label='Secondary Mark 2' @vertical={{true}}>
            <div class='preview-field'>
              {{#let (getField @model 'secondaryMark2') as |f|}}
                <p>{{f.description}}</p>
              {{/let}}
              <PreviewContainer @variant='primary'>
                <@fields.secondaryMark2 class='inverse' />
              </PreviewContainer>
            </div>
          </FieldContainer>
        </GridContainer>
        {{! greyscale versions }}
        <FieldContainer @label='Greyscale versions' @vertical={{true}}>
          <div class='preview-field'>
            <p>When full color option is not available, for display on light &
              dark backgrounds</p>
            <PreviewContainer class='preview-grid container-group'>
              <PreviewContainer @hideBoundaries={{true}} @radius='none'>
                {{#if @model.primaryMarkGreyscale1}}
                  <@fields.primaryMarkGreyscale1 />
                {{else}}
                  <@fields.primaryMark1 class='grayscale' />
                {{/if}}
                {{#if @model.secondaryMarkGreyscale1}}
                  <@fields.secondaryMarkGreyscale1 />
                {{else if @model.secondaryMark1}}
                  <@fields.secondaryMark1 class='grayscale' />
                {{/if}}
              </PreviewContainer>
              <PreviewContainer
                @variant='inverse'
                @hideBoundaries={{true}}
                @radius='none'
              >
                {{#if @model.primaryMarkGreyscale2}}
                  <@fields.primaryMarkGreyscale2 />
                {{else}}
                  <@fields.primaryMark2 class='grayscale' />
                {{/if}}
                {{#if @model.secondaryMarkGreyscale2}}
                  <@fields.primaryMarkGreyscale2 />
                {{else if @model.secondaryMark2}}
                  <@fields.secondaryMark2 class='grayscale' />
                {{/if}}
              </PreviewContainer>
            </PreviewContainer>
          </div>
        </FieldContainer>
        {{! social media icon }}
        <FieldContainer @label='Social media/profile icon' @vertical={{true}}>
          <div class='preview-field'>
            {{#let (getField @model 'socialMediaProfileIcon') as |field|}}
              <p>{{field.description}}</p>
            {{/let}}
            <PreviewContainer class='preview-grid container-group'>
              <PreviewContainer @hideBoundaries={{true}} @radius='none'>
                <PreviewContainer @size='icon'>
                  <@fields.socialMediaProfileIcon />
                </PreviewContainer>
              </PreviewContainer>
              <PreviewContainer
                class='media-handle-group'
                @hideBoundaries={{true}}
                @radius='none'
              >
                <PreviewContainer @size='icon'>
                  <@fields.socialMediaProfileIcon />
                </PreviewContainer>
                <span class='media-handle'>@username</span>
              </PreviewContainer>
            </PreviewContainer>
          </div>
        </FieldContainer>
      </BoxelContainer>

      <BoxelContainer
        @tag='section'
        @display='grid'
        class='content-section typography-section'
      >
        <h2>Typography</h2>
        <GridContainer class='preview-grid'>
          <@fields.headline />
          <@fields.bodyCopy />
        </GridContainer>
      </BoxelContainer>

      <BoxelContainer
        @tag='section'
        @display='grid'
        class='content-section components-section'
      >
        <h2>UI Components</h2>
      </BoxelContainer>
    </article>
    <style scoped>
      h1,
      h2 {
        margin-block: 0;
        font-size: var(--typescale-h1, var(--boxel-font-size-med));
        font-weight: 600;
        letter-spacing: var(--boxel-lsp-xs);
        line-height: calc(28 / 20);
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
        min-height: 23.125rem; /* 370px */
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 0;
        background-color: var(--primary);
        color: var(--primary-foreground);
      }
      .content-section + .content-section {
        border-top: var(--boxel-border);
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

class PreviewContainer extends GlimmerComponent<{
  Args: {
    hideBoundaries?: boolean;
    radius?: 'default' | 'round' | 'none'; // default is curved
    size?: 'default' | 'icon';
    variant?: 'default' | 'inverse' | 'muted' | 'primary'; // default is light-mode
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}> {
  <template>
    <BoxelContainer
      class={{cn
        'preview-container'
        (if @variant (concat 'variant-' @variant) 'variant-default')
        (if @size (concat 'size-' @size) 'size-default')
        (if @radius (concat 'radius-' @radius) 'radius-default')
        (unless @hideBoundaries 'display-boundaries')
      }}
      ...attributes
    >
      {{yield}}
    </BoxelContainer>
    <style scoped>
      @layer boxelComponentL1 {
        .preview-container {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--boxel-sp);
          max-width: 100%;
          overflow: hidden;
        }
        .size-default {
          --boxel-container-padding: var(--boxel-sp-xl);
          width: 100%;
          min-height: 11.25rem; /* 180px */
        }
        .size-icon {
          --boxel-container-padding: 0;
          flex-shrink: 0;
          width: var(--boxel-icon-size); /* 40px */
          height: var(--boxel-icon-size); /* 40px */
          aspect-ratio: 1;
          border-radius: var(--boxel-border-radius-sm);
        }
        .display-boundaries {
          border: var(--container-border, var(--boxel-border));
        }
        .variant-default {
          background-color: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
        }
        .variant-inverse {
          background-color: var(--foreground, var(--boxel-dark));
          color: var(--background, var(--boxel-light));
        }
        .variant-primary {
          background-color: var(--primary, var(--boxel-dark));
          color: var(--primary-foreground, var(--boxel-light));
        }
        .variant-muted {
          background-color: var(--muted, var(--boxel-100));
          color: var(--foreground, var(--boxel-dark));
        }
        .radius-default {
          border-radius: var(--boxel-border-radius);
        }
        .radius-round {
          border-radius: 50%;
        }
        .radius-none {
          border-radius: 0;
        }
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
      <Swatch @label={{@model.name}} @color={{@model.value}} />
    </template>
  };
}

class PaletteComponent extends GlimmerComponent<{
  Args: { colors?: { name?: string; value?: string | null }[] };
  Element: HTMLElement;
}> {
  <template>
    <GridContainer class='view-palette' ...attributes>
      {{#each @colors as |color|}}
        <FieldContainer @label={{color.name}} @vertical={{true}}>
          <Swatch @color={{color.value}} />
        </FieldContainer>
      {{/each}}
    </GridContainer>
    <style scoped>
      .view-palette {
        grid-template-columns: repeat(auto-fill, 7rem);
      }
    </style>
  </template>
}

class FunctionalPaletteEmbedded extends Component<typeof FunctionalPalette> {
  <template>
    <PaletteComponent @colors={{this.palette}} />
    <style scoped>
      .functional-palette {
        grid-template-columns: repeat(auto-fill, 7rem);
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>

  private get palette() {
    return Object.keys(this.args.fields)
      ?.map((fieldName) => ({
        name: startCase(fieldName),

        value: (this.args.model as Record<string, any>)?.[fieldName],
      }))
      .filter((item) => Boolean(item.value));
  }
}

export class MarkField extends URLField {
  static displayName = 'Mark URL';
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <img
        class='mark-image'
        src={{@model}}
        role='presentation'
        {{! @glint-ignore }}
        ...attributes
      />
      <style scoped>
        @layer {
          .mark-image {
            min-width: 50%;
            width: auto;
            height: var(--logo-min-height, 2.5rem);
          }
        }
      </style>
    </template>
  };
}

export class CSSPropertyValueField extends StringField {
  static displayName = 'CSS Property Value';

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <code class='css-property-value'>{{if
          @model
          @model
          '/* not set */'
        }}</code>
    </template>
  };
}

export class FunctionalPalette extends FieldDef {
  static displayName = 'Functional Palette';
  @field primary = contains(ColorField);
  @field secondary = contains(ColorField);
  @field neutral = contains(ColorField);
  @field light = contains(ColorField);
  @field accent = contains(ColorField);

  static embedded = FunctionalPaletteEmbedded;
}

class TypographyField extends FieldDef {
  static displayName = 'Typography';
  @field fontFamily = contains(CSSPropertyValueField);
  @field fontSize = contains(CSSPropertyValueField);
  @field fontWeight = contains(CSSPropertyValueField);
  @field lineHeight = contains(CSSPropertyValueField);
  @field color = contains(ColorField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <FieldContainer @vertical={{true}}>
        <div class='preview-field'>
          <p>{{this.styleSummary}}</p>
          <PreviewContainer
            @variant='muted'
            @hideBoundaries={{true}}
            class='typography-preview'
            style={{this.styles}}
          >
            The quick brown fox
          </PreviewContainer>
        </div>
      </FieldContainer>

      <style scoped>
        .preview-field {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        p {
          margin-block: 0;
        }
      </style>
    </template>

    private get styles() {
      let { fontFamily, fontSize, fontWeight, lineHeight, color } =
        this.args.model;
      let styles = [];
      if (fontFamily) {
        styles.push(`font-family: ${fontFamily}`);
      }
      if (fontSize) {
        styles.push(`font-size: ${fontSize}`);
      }
      if (fontWeight) {
        styles.push(`font-weight: ${fontWeight}`);
      }
      if (lineHeight) {
        styles.push(`line-height: ${lineHeight}`);
      }
      if (color) {
        styles.push(`color: ${color}`);
      }
      return sanitizeHtmlSafe(styles.join('; '));
    }

    private get styleSummary() {
      let { fontFamily, fontSize, fontWeight, color } = this.args.model;

      switch (fontWeight) {
        case '300':
        case 'light':
          fontWeight = 'light';
          break;
        case '400':
        case 'normal':
          fontWeight = 'normal';
          break;
        case '500':
        case 'medium':
          fontWeight = 'medium';
          break;
        case '600':
        case 'semibold':
          fontWeight = 'semibold';
          break;
        case '700':
        case 'bold':
          fontWeight = 'bold';
          break;
        case '800':
        case 'extrabold':
          fontWeight = 'extrabold';
          break;
        default:
          fontWeight;
      }

      fontFamily = fontFamily?.split(',')?.[0]?.replace(/'/g, '') ?? 'Poppins';

      return sanitizeHtmlSafe(
        `${fontFamily} ${fontWeight ?? 'normal'}, ${fontSize ?? '16px'} ${
          color ?? '#000000'
        }`,
      );
    }
  };
}

export default class BrandGuide extends StyleReference {
  static displayName = 'Brand Guide';

  // Color Palettes
  @field brandColorPalette = containsMany(CompoundColorField);
  @field functionalPalette = contains(FunctionalPalette);

  // Mark Usage
  // primary mark
  @field primaryMarkClearanceRatio = contains(StringField);
  @field primaryMarkMinHeight = contains(StringField);
  @field primaryMark1 = contains(MarkField, {
    description: 'For use on light background',
  });
  @field primaryMark2 = contains(MarkField, {
    description: 'For use on dark background',
  });
  @field primaryMarkGreyscale1 = contains(MarkField, {
    description: 'Greyscale version for use on light background',
  });
  @field primaryMarkGreyscale2 = contains(MarkField, {
    description: 'Greyscale version for use on dark background',
  });
  // secondary mark
  @field secondaryMarkClearanceRatio = contains(StringField);
  @field secondaryMarkMinHeight = contains(StringField);
  @field secondaryMark1 = contains(MarkField, {
    description: 'For use on light background',
  });
  @field secondaryMark2 = contains(MarkField, {
    description: 'For use on dark background',
  });
  @field secondaryMarkGreyscale1 = contains(MarkField, {
    description: 'Greyscale version for use on light background',
  });
  @field secondaryMarkGreyscale2 = contains(MarkField, {
    description: 'Greyscale version for use on dark background',
  });
  // social media mark
  @field socialMediaProfileIcon = contains(MarkField, {
    description:
      'For social media purposes or any small format usage requiring 1:1 aspect ratio',
  });

  // Typography
  @field headline = contains(TypographyField);
  @field bodyCopy = contains(TypographyField);

  // UI Components
  // TODO
  @field cornerRadius = contains(CSSPropertyValueField);
  @field spacingUnit = contains(CSSPropertyValueField);
  @field cssVariables = contains(CSSField, {
    computeVia: function (this: BrandGuide) {
      return this.computeCSSFromFields();
    },
  });

  private calcForeground(bgColor?: string) {
    let darkColor = this.bodyCopy.color ?? '#000';
    let lightColor = this.functionalPalette.light ?? '#fff';
    return getContrastColor(bgColor, darkColor, lightColor);
  }

  private computeCSSFromFields() {
    const cssBlocks: string[] = [];

    const rootVars: string[] = [];
    // colors
    this.addCSSVar(rootVars, '--primary', this.functionalPalette.primary);
    this.addCSSVar(rootVars, '--secondary', this.functionalPalette.secondary);
    this.addCSSVar(rootVars, '--background', this.functionalPalette.light);
    this.addCSSVar(rootVars, '--muted', this.functionalPalette.neutral);
    this.addCSSVar(rootVars, '--accent', this.functionalPalette.accent);
    this.addCSSVar(
      rootVars,
      '--primary-foreground',
      this.calcForeground(this.functionalPalette.primary),
    );
    this.addCSSVar(
      rootVars,
      '--secondary-foreground',
      this.calcForeground(this.functionalPalette.secondary),
    );
    this.addCSSVar(
      rootVars,
      '--muted-foreground',
      this.calcForeground(this.functionalPalette.neutral),
    );
    this.addCSSVar(
      rootVars,
      '--accent-foreground',
      this.calcForeground(this.functionalPalette.accent),
    );

    // mark usage
    if (this.primaryMarkMinHeight && this.primaryMarkClearanceRatio) {
      this.addCSSVar(
        rootVars,
        '--logo-primary-clearance',
        `calc(${this.primaryMarkMinHeight} * ${this.primaryMarkClearanceRatio})`,
      );
    }
    if (this.secondaryMarkMinHeight && this.secondaryMarkClearanceRatio) {
      this.addCSSVar(
        rootVars,
        '--logo-secondary-clearance',
        `calc(${this.secondaryMarkMinHeight} * ${this.secondaryMarkClearanceRatio})`,
      );
    }
    this.addCSSVar(
      rootVars,
      '--logo-primary-min-height',
      this.primaryMarkMinHeight,
    );
    this.addCSSVar(
      rootVars,
      '--logo-secondary-min-height',
      this.secondaryMarkMinHeight,
    );

    // typography
    this.addCSSVar(
      rootVars,
      '--font-family-h1',
      this.headline.fontFamily ?? this.bodyCopy.fontFamily,
    );
    this.addCSSVar(rootVars, '--typescale-h1', this.headline.fontSize);
    this.addCSSVar(rootVars, '--font-weight-h1', this.headline.fontWeight);
    this.addCSSVar(rootVars, '--lineheight-h1', this.headline.lineHeight);
    this.addCSSVar(rootVars, '--foreground-h1', this.headline.color);

    this.addCSSVar(rootVars, '--font-family-base', this.bodyCopy.fontFamily);
    this.addCSSVar(rootVars, '--typescale-body', this.bodyCopy.fontSize);
    this.addCSSVar(rootVars, '--font-weight-base', this.bodyCopy.fontWeight);
    this.addCSSVar(rootVars, '--lineheight-base', this.bodyCopy.lineHeight);
    this.addCSSVar(rootVars, '--foreground', this.bodyCopy.color);

    // other
    this.addCSSVar(rootVars, '--radius', this.cornerRadius);
    this.addCSSVar(rootVars, '--spacing', this.spacingUnit);

    if (rootVars.length > 0) {
      cssBlocks.push(`:root {\n${rootVars.join('\n')}\n}`);
    }

    return cssBlocks.join('\n\n');
  }

  private addCSSVar(
    vars: string[],
    property: string,
    value: string | undefined | null,
  ): void {
    let val = value?.replace(';', '')?.trim();
    if (val?.length) {
      vars.push(`  ${property}: ${val};`);
    }
  }

  static isolated = BrandGuideIsolated;
}
