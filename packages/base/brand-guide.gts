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
  type BaseDefComponent,
} from './card-api';
import ColorField from './color';
import URLField from './url';
import StyleReference from './style-reference';
import CSSValueField from './css-value';
import {
  BoxelContainer,
  FieldContainer,
  GridContainer,
  Swatch,
} from '@cardstack/boxel-ui/components';
import {
  cn,
  sanitizeHtmlSafe,
  buildCssGroups,
  entriesToCssRuleMap,
  generateCssVariables,
} from '@cardstack/boxel-ui/helpers';

class Isolated extends Component<typeof BrandGuide> {
  <template>
    <BoxelContainer>
      <h1><@fields.title /></h1>
      <FieldContainer @label='CSS Variables'>
        <@fields.cssVariables />
      </FieldContainer>
    </BoxelContainer>
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

export class FunctionalPalette extends FieldDef {
  static displayName = 'Functional Palette';
  @field primary = contains(ColorField);
  @field secondary = contains(ColorField);
  @field neutral = contains(ColorField);
  @field light = contains(ColorField);
  @field dark = contains(ColorField);
  @field accent = contains(ColorField);

  static embedded = FunctionalPaletteEmbedded;
}

class TypographyField extends FieldDef {
  static displayName = 'Typography';
  @field fontFamily = contains(CSSValueField);
  @field fontSize = contains(CSSValueField);
  @field fontWeight = contains(CSSValueField);
  @field lineHeight = contains(CSSValueField);
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

  // CSS Variables computed from field entries
  @field cssVariables = contains(CSSField, {
    computeVia: function (this: BrandGuide) {
      if (!generateCssVariables || !buildCssGroups) {
        return;
      }
      const cloneRules = (rules?: Map<string, string>) =>
        rules?.size ? new Map(rules) : new Map<string, string>();

      let combinedRootRules = cloneRules(this.rootVariables?.cssRuleMap);
      let combinedDarkRules = cloneRules(this.darkModeVariables?.cssRuleMap);

      const paletteRules = this.brandColorPalette?.length
        ? entriesToCssRuleMap?.(
            this.brandColorPalette.map((entry) => ({
              name: entry?.name ?? undefined,
              value: entry?.value ?? undefined,
            })),
          )
        : undefined;

      if (paletteRules?.size) {
        for (let [name, value] of paletteRules.entries()) {
          combinedRootRules.set(name, value);
          combinedDarkRules.set(name, value);
        }
      }
      return generateCssVariables(
        buildCssGroups([
          { selector: ':root', rules: combinedRootRules },
          { selector: '.dark', rules: combinedDarkRules },
        ]),
      );
    },
  });

  static isolated: BaseDefComponent = Isolated;
}
