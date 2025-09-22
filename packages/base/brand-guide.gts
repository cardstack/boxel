import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { startCase } from 'lodash';
import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
} from './card-api';
import ColorField from './color';
import { GridContainer, Swatch } from '@cardstack/boxel-ui/components';

type Color = {
  name?: string;
  value?: string;
};

export class CompoundColorField extends FieldDef {
  static displayName = 'Color';
  @field name = contains(StringField);
  @field value = contains(ColorField);
}

const ViewPalette: TemplateOnlyComponent<{ Args: { colors?: Color[] } }> =
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
      :deep(.label) {
        font-weight: 600;
      }
    </style>
  </template>;

class FunctionalPaletteEmbedded extends Component<typeof FunctionalPalette> {
  <template>
    <ViewPalette @colors={{this.palette}} />
    <style scoped>
      .functional-palette {
        grid-template-columns: repeat(auto-fill, 7rem);
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>

  private get palette(): Color[] | undefined {
    console.log(Object.keys(this.args.fields));
    return Object.keys(this.args.fields)?.map((fieldName) => ({
      name: startCase(fieldName),
      value: this.args.model?.[fieldName] ?? 'n/a',
    }));
  }
}

export class FunctionalPalette extends FieldDef {
  static displayName = 'Functional Palette';
  @field primary = contains(ColorField);
  @field secondary = contains(ColorField);
  @field dark = contains(ColorField);
  @field light = contains(ColorField);
  @field neutral = contains(ColorField);
  @field accent = contains(ColorField);

  static embedded = FunctionalPaletteEmbedded;
}

export class BrandGuide extends CardDef {
  static displayName = 'Brand Guide';

  @field brandColorPalette = containsMany(CompoundColorField);
  @field functionalPalette = contains(FunctionalPalette);

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
