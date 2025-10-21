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
} from '@cardstack/boxel-ui/helpers';

import BrandTypography from './brand-typography';
import BrandFunctionalPalette from './brand-functional-palette';

const rootToBrandVariableMapping: Record<string, string> = {
  '--primary': '--brand-primary',
  '--secondary': '--brand-secondary',
  '--muted': '--brand-neutral',
  '--accent': '--brand-accent',
  '--background': '--brand-light',
  '--foreground': '--brand-dark',
  '--primary-foreground': '--brand-primary-foreground',
  '--secondary-foreground': '--brand-secondary-foreground',
  '--muted-foreground': '--brand-neutral-foreground',
  '--accent-foreground': '--brand-accent-foreground',
};

class BrandGuideIsolated extends Component<typeof BrandGuide> {
  <template>
    <article class='brand-guide'>
      <BoxelContainer @tag='header' @display='flex' class='header-section'>
        <h1><@fields.title /></h1>
        {{#if @model.description}}
          <p><@fields.description /></p>
        {{/if}}
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
      let combinedRootRules = new Map<string, string>();
      let rootRules = this.rootVariables?.cssRuleMap;
      let functionalRules = this.functionalPalette?.cssRuleMap;

      for (let [rootName, brandName] of Object.entries(
        rootToBrandVariableMapping,
      )) {
        let rootValue = rootRules?.get(rootName);
        let brandValue = functionalRules?.get(brandName) ?? '';
        combinedRootRules.set(brandName, brandValue);
        if (rootValue) {
          combinedRootRules.set(rootName, `var(${brandName}, ${rootValue})`);
        } else {
          combinedRootRules.set(rootName, `var(${brandName})`);
        }
      }

      if (rootRules?.size) {
        for (let [rootName, rootValue] of rootRules.entries()) {
          if (!combinedRootRules.has(rootName) && rootValue) {
            combinedRootRules.set(rootName, rootValue);
          }
        }
      }

      if (entriesToCssRuleMap && this.brandColorPalette?.length) {
        let paletteRules = entriesToCssRuleMap(this.brandColorPalette);
        for (let [name, value] of paletteRules.entries()) {
          if (name && value) {
            name = name.replace(/\s+/g, '-');
            if (name.startsWith('--')) {
              name = name.replace(/^--/, '--brand-color-');
            } else {
              name = `--brand-color-${name}`;
            }
            combinedRootRules.set(name, value);
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
