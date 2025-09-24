import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { startCase } from 'lodash';
import {
  CardDef,
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
import { GridContainer, Swatch } from '@cardstack/boxel-ui/components';

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

const PaletteComponent: TemplateOnlyComponent<{
  Args: { colors?: { name?: string; value?: string | null }[] };
}> = <template>
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
</template>;

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
  @field background = contains(ColorField);
  @field foreground = contains(ColorField);
  @field border = contains(ColorField);
  @field muted = contains(ColorField);
  @field accent = contains(ColorField);
  @field dark = contains(ColorField);
  @field light = contains(ColorField);

  static embedded = FunctionalPaletteEmbedded;
}

class MarkUsageField extends FieldDef {
  static displayName = 'Mark Usage';
  @field clearanceRatio = contains(CSSPropertyValueField);
  @field minHeight = contains(CSSPropertyValueField);
  @field onLightBackground = contains(URLField);
  @field onDarkBackground = contains(URLField);
}

class TypographyField extends FieldDef {
  static displayName = 'Typography';
  @field fontFamily = contains(CSSPropertyValueField);
  @field fontSize = contains(CSSPropertyValueField);
  @field fontWeight = contains(CSSPropertyValueField);
  @field lineHeight = contains(CSSPropertyValueField);
  @field letterSpacing = contains(CSSPropertyValueField);
}

export class BrandGuide extends CardDef {
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
    this.addCSSVar(rootVars, '--background', this.functionalPalette.background);
    this.addCSSVar(rootVars, '--foreground', this.functionalPalette.foreground);
    this.addCSSVar(rootVars, '--border', this.functionalPalette.border);
    this.addCSSVar(rootVars, '--muted', this.functionalPalette.muted);
    this.addCSSVar(rootVars, '--accent', this.functionalPalette.accent);

    // typography
    this.addCSSVar(rootVars, '--font-sans', this.bodyCopy.fontFamily);

    this.addCSSVar(rootVars, '--typescale-h1', this.headline.fontSize);
    this.addCSSVar(rootVars, '--typescale-body', this.bodyCopy.fontSize);
    this.addCSSVar(rootVars, '--lineheight-base', this.bodyCopy.lineHeight);

    // other
    this.addCSSVar(rootVars, '--radius', this.cornerRadius);
    // this.addCSSVar(rootVars, '--spacing', this.spacing);

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

  // static isolated = class Isolated extends Component<typeof this> {
  //   <template>
  //     <BoxelContainer @tag='article' class='brand-guide'>
  //       <header class='guide-header'>
  //         <h1><@fields.title /></h1>
  //         {{#if @model.description}}
  //           <p><@fields.description /></p>
  //         {{/if}}
  //       </header>
  //       <section class='guide-content'>
  //         <section class='content-section'>
  //           <section>
  //             <h2>Brand Color Palette</h2>
  //             <@fields.brandColorPalette />
  //           </section>
  //           <section>
  //             <h2>Functional Palette</h2>
  //             <@fields.functionalPalette />
  //           </section>
  //         </section>
  //         <section class='content-section'>
  //           <h2>Mark Usage</h2>
  //         </section>
  //         <section class='content-section'>
  //           <h2>Typography</h2>
  //         </section>
  //         <section class='content-section'>
  //           <h2>UI Components</h2>
  //         </section>
  //       </section>
  //     </BoxelContainer>
  //     <style scoped>
  //       .brand-guide {
  //         height: 100%;
  //       }
  //       .guide-header {
  //         padding: var(--boxel-sp-xl);
  //       }
  //       .guide-content {
  //         padding: var(--boxel-sp-xl);
  //       }
  //       .content-section + .content-section {
  //         border-top: var(--boxel-border);
  //       }
  //       h1,
  //       h2 {
  //         margin-block: 0;
  //         font-size: var(--typescale-h1, var(--boxel-font-size-med));
  //         font-weight: 600;
  //         letter-spacing: var(--boxel-lsp-xs);
  //         line-height: calc(28 / 20);
  //       }
  //     </style>
  //   </template>
  // };
}
