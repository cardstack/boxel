import GlimmerComponent from '@glimmer/component';
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
import { sanitizeHtmlSafe } from '@cardstack/boxel-ui/helpers';
import { getField } from '@cardstack/runtime-common';
import UrlField from './url';
import setBackgroundImage from './helpers/set-background-image';

class BrandGuideIsolated extends Component<typeof BrandGuide> {
  <template>
    <article class='brand-guide'>
      <BoxelContainer @tag='header' @display='flex' class='guide-header'>
        <h1><@fields.title /></h1>
        {{#if @model.description}}
          <p><@fields.description /></p>
        {{/if}}
      </BoxelContainer>

      <BoxelContainer @tag='section' class='content-section'>
        {{#if @model.brandColorPalette.length}}
          <section class='inner-section'>
            <h2>Brand Color Palette</h2>
            <@fields.brandColorPalette />
          </section>
        {{/if}}
        <section class='inner-section'>
          <h2>Functional Palette</h2>
          <@fields.functionalPalette />
        </section>
      </BoxelContainer>
      <BoxelContainer @tag='section' class='content-section'>
        <h2>Mark Usage</h2>
        <FieldContainer
          class='inner-section'
          @vertical={{true}}
          @label='Primary Mark'
        >
          <@fields.primaryMark />
        </FieldContainer>
        <FieldContainer
          class='inner-section'
          @vertical={{true}}
          @label='Secondary Mark'
        >
          <@fields.secondaryMark />
        </FieldContainer>
      </BoxelContainer>
      <BoxelContainer @tag='section' class='content-section'>
        <h2>Typography</h2>
        <GridContainer class='preview-grid'>
          <@fields.headline />
          <@fields.bodyCopy />
        </GridContainer>
      </BoxelContainer>
      <BoxelContainer @tag='section' class='content-section'>
        <h2>UI Components</h2>
      </BoxelContainer>
    </article>
    <style scoped>
      .brand-guide {
        --boxel-container-padding: var(--boxel-sp-xl);
        height: 100%;
      }
      .guide-header {
        padding: var(--boxel-sp-xl);
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 0;
      }
      .content-section + .content-section {
        border-top: var(--boxel-border);
      }
      .inner-section + .inner-section {
        margin-top: var(--boxel-sp);
      }
      h1,
      h2 {
        margin-block: 0;
        font-size: var(--typescale-h1, var(--boxel-font-size-med));
        font-weight: 600;
        letter-spacing: var(--boxel-lsp-xs);
        line-height: calc(28 / 20);
      }
      h2 + * {
        margin-top: var(--boxel-sp);
      }
      .preview-grid {
        grid-template-columns: 1fr 1fr;
      }
    </style>
  </template>
}

class PreviewContainer extends GlimmerComponent<{
  Element: HTMLElement;
  Blocks: { default: [] };
}> {
  <template>
    <BoxelContainer class='preview-container' @display='flex' ...attributes>
      {{yield}}
    </BoxelContainer>
    <style scoped>
      .preview-container {
        min-height: 11.25rem;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius, var(--boxel-border-radius));
        background-color: var(--muted, var(--boxel-100));
        color: var(--foreground, var(--boxel-dark));
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
}> {
  <template>
    <GridContainer class='view-palette'>
      {{#each @colors as |color|}}
        <Swatch @label={{color.name}} @color={{color.value}} />
      {{/each}}
    </GridContainer>
    <style scoped>
      .view-palette {
        grid-template-columns: repeat(auto-fill, 7rem);
        gap: var(--boxel-sp);
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

class MarkField extends UrlField {
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <PreviewContainer class='mark-preview'>
        <div class='mark-image' style={{setBackgroundImage @model}} />
      </PreviewContainer>
      <style scoped>
        .mark-preview {
          background-color: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          border: 1px solid
            color-mix(
              in oklab,
              var(--neutral, var(--boxel-100)) 90%,
              var(--foreground, var(--boxel-dark))
            );
        }
        .mark-image {
          width: 100%;
          min-height: inherit;
          background-repeat: no-repeat;
          background-position: center;
          background-size: contain;
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

class MarkUsageField extends FieldDef {
  static displayName = 'Mark Usage';
  @field clearanceRatio = contains(CSSPropertyValueField);
  @field minHeight = contains(CSSPropertyValueField);
  @field onLightBackground = contains(MarkField, {
    description: 'For use on light background',
  });
  @field onDarkBackground = contains(MarkField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer class='preview-grid'>
        <div class='preview-field'>
          {{#let (getField @model 'onLightBackground') as |f|}}
            <p>{{f.description}}</p>
          {{/let}}
          <@fields.onLightBackground />
        </div>
        <div class='preview-field dark-mode'>
          <p>For use on dark background</p>
          <@fields.onDarkBackground />
        </div>
      </GridContainer>

      <style scoped>
        .preview-grid {
          grid-template-columns: 1fr 1fr;
        }
        .preview-field {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        p {
          margin-block: 0;
        }
        .dark-mode :deep(.mark-preview) {
          background-color: var(--foreground, var(--boxel-dark));
          color: var(--background, var(--boxel-light));
        }
      </style>
    </template>
  };
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
          <PreviewContainer class='typography-preview' style={{this.styles}}>
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

  @field brandColorPalette = containsMany(CompoundColorField);
  @field functionalPalette = contains(FunctionalPalette);

  // Mark Usage
  @field primaryMark = contains(MarkUsageField);
  @field secondaryMark = contains(MarkUsageField);
  @field greyscaleMark = contains(MarkUsageField);
  @field socialMediaProfileIcon = contains(URLField);

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

  private computeCSSFromFields() {
    const cssBlocks: string[] = [];

    const rootVars: string[] = [];
    // colors
    this.addCSSVar(rootVars, '--primary', this.functionalPalette.primary);
    this.addCSSVar(rootVars, '--secondary', this.functionalPalette.secondary);
    this.addCSSVar(rootVars, '--background', this.functionalPalette.light);
    this.addCSSVar(rootVars, '--muted', this.functionalPalette.neutral);
    this.addCSSVar(rootVars, '--accent', this.functionalPalette.accent);

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
