import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import {
  BoxelButton,
  GridContainer,
  BoxelInput,
  CopyButton,
} from '@cardstack/boxel-ui/components';
import {
  buildCssGroups,
  generateCssVariables,
  parseCssGroups,
  type CssRuleMap,
} from '@cardstack/boxel-ui/helpers';
import CaretUp from '@cardstack/boxel-icons/chevron-up';
import CaretDown from '@cardstack/boxel-icons/chevron-down';

import {
  field,
  contains,
  Component,
  CSSField,
  Theme,
  type BaseDefComponent,
} from './card-api';
import ThemeVarField, {
  ThemeTypographyField,
} from './structured-theme-variables';

interface SectionToggleSignature {
  Args: {
    expanded: boolean;
    onToggle: (event: Event) => void;
  };
  Element: HTMLButtonElement;
}

export class ThemeHeader extends GlimmerComponent<{
  Args: {
    title?: string;
    version?: string;
    description?: string;
    toggleMode?: () => void;
    isDarkMode?: boolean;
  };
  Element: HTMLElement;
}> {
  <template>
    <header class='theme-header' ...attributes>
      <div class='header-meta'>
        <span class='meta-label'>Style Guide</span>
        <span class='meta-version'>Version {{if @version @version '1.0'}}</span>
      </div>
      <h1 class='style-title'>{{@title}}</h1>
      {{#if @description}}
        <p class='style-tagline'>{{@description}}</p>
      {{/if}}
    </header>
    <style scoped>
      @layer baseComponent {
        .theme-header {
          border-bottom: 1px solid var(--border);
          padding: calc(var(--boxel-sp) * 3) calc(var(--boxel-sp) * 2);
          background: var(--card);
          color: var(--card-foreground);
        }
        .header-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: calc(var(--boxel-sp) * 1.5);
          font-size: var(--boxel-caption-font-size);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-xxl);
          font-weight: 600;
          color: var(--muted-foreground);
        }
        .style-title {
          font-size: clamp(2rem, 5vw, 3.5rem);
          font-weight: 700;
          line-height: 1.1;
          margin-bottom: calc(var(--boxel-sp) * 0.75);
          letter-spacing: -0.02em;
        }
        .style-tagline {
          font-size: var(--boxel-font-size);
          color: var(--muted-foreground);
          max-width: 48rem;
          line-height: 1.5;
        }
        .theme-mode-toggle {
          margin-top: calc(var(--boxel-sp) * 1.5);
        }

        @media (max-width: 768px) {
          .theme-header {
            padding: calc(var(--boxel-sp) * 2) var(--boxel-sp);
          }
          .style-title {
            font-size: clamp(1.75rem, 8vw, 2.5rem);
          }
        }
      }
    </style>
  </template>
}

class SectionToggleButton extends GlimmerComponent<SectionToggleSignature> {
  <template>
    <BoxelButton
      class='section-toggle'
      @kind='text-only'
      @size='auto'
      aria-expanded={{@expanded}}
      {{on 'click' @onToggle}}
      ...attributes
    >
      <span class='section-toggle__label'>{{if @expanded 'Hide' 'Show'}}</span>
      {{#if @expanded}}
        <CaretUp width='14' height='14' role='presentation' />
      {{else}}
        <CaretDown width='14' height='14' role='presentation' />
      {{/if}}
    </BoxelButton>

    <style scoped>
      @layer baseComponent {
        .section-toggle {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxxs);
          padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
          background: none;
          border: none;
          min-height: 1.5rem;
        }
        .section-toggle:hover {
          color: var(--primary);
          text-decoration: underline;
        }
        .section-toggle__label {
          font-size: var(--boxel-font-size-xs);
          line-height: 1;
          text-transform: uppercase;
        }
      }
    </style>
  </template>
}

// Applies parsed CSS rules back onto the card fields for editing.
export const applyCssRulesToField = (
  field: ThemeVarField | undefined,
  rules: CssRuleMap | undefined,
) => {
  if (!field || !rules?.size) {
    return;
  }
  const cssFields = field.cssVariableFields;
  if (!cssFields?.length) {
    return;
  }
  const lookup = new Map<string, string>(
    cssFields.map((f) => [f.cssVariableName, f.fieldName]),
  );
  for (let [property, value] of rules.entries()) {
    const fieldName = lookup.get(property);
    if (!fieldName) {
      continue;
    }
    (field as any)[fieldName] = value;
  }
};

// TODO: move to boxel-ui helpers
export const mergeRuleMaps = (
  ...maps: (CssRuleMap | undefined)[]
): CssRuleMap | undefined => {
  let combined: CssRuleMap | undefined;
  for (let map of maps) {
    if (!map?.size) {
      continue;
    }
    if (!combined) {
      combined = new Map(map);
      continue;
    }
    for (let [name, value] of map.entries()) {
      if (!name || !value) {
        continue;
      }
      combined.set(name, value);
    }
  }
  return combined;
};

class Isolated extends Component<typeof StructuredTheme> {
  @tracked isCssTextareaVisible = true;
  @tracked isRootVariablesVisible = true;
  @tracked isDarkVariablesVisible = true;
  @tracked areCSSImportsVisible = true;
  @tracked isGeneratedCSSVisible = true;

  @action toggleCssTextarea() {
    this.isCssTextareaVisible = !this.isCssTextareaVisible;
  }

  @action toggleRootVariables() {
    this.isRootVariablesVisible = !this.isRootVariablesVisible;
  }

  @action toggleDarkVariables() {
    this.isDarkVariablesVisible = !this.isDarkVariablesVisible;
  }

  @action toggleCSSImports() {
    this.areCSSImportsVisible = !this.areCSSImportsVisible;
  }

  @action toggleGeneratedCSS() {
    this.isGeneratedCSSVisible = !this.isGeneratedCSSVisible;
  }

  @action parseCss(content: string) {
    if (!content || !parseCssGroups) {
      return;
    }
    const groups = parseCssGroups(content);
    if (!groups?.size) {
      return;
    }
    applyCssRulesToField(this.args.model?.rootVariables, groups.get(':root'));
    applyCssRulesToField(
      this.args.model?.darkModeVariables,
      groups.get('.dark'),
    );
  }

  private cssPlaceholder = `:root {
  /* ... */
}

.dark {
  /* ... */
}`;

  <template>
    <GridContainer @tag='article' class='structured-theme-card'>
      <ThemeHeader
        @title={{@model.title}}
        @description={{@model.description}}
      />
      <GridContainer @tag='section' class='content-section'>
        <GridContainer @tag='header' class='section-header'>
          <h2>Insert CSS Variables</h2>
          <SectionToggleButton
            @expanded={{this.isCssTextareaVisible}}
            @onToggle={{this.toggleCssTextarea}}
            aria-controls='insert-css-content'
          />
        </GridContainer>
        {{#if this.isCssTextareaVisible}}
          <div id='insert-css-content' class='section-body'>
            <label for='css-textarea' class='boxel-sr-only'>Insert CSS Variables</label>
            <BoxelInput
              id='css-textarea'
              @type='textarea'
              @onInput={{this.parseCss}}
              @placeholder={{this.cssPlaceholder}}
              class='css-textarea'
              data-test-custom-css-variables
            />
          </div>

        {{/if}}
      </GridContainer>

      <GridContainer @tag='section' class='content-section'>
        <GridContainer @tag='header' class='section-header'>
          <h2>Root Variables (:root)</h2>
          <SectionToggleButton
            @expanded={{this.isRootVariablesVisible}}
            @onToggle={{this.toggleRootVariables}}
            aria-controls='root-variables-content'
          />
        </GridContainer>
        {{#if this.isRootVariablesVisible}}
          <div
            id='root-variables-content'
            class='section-body'
            data-test-root-vars
          >
            <@fields.rootVariables />
          </div>
        {{/if}}
      </GridContainer>

      <GridContainer @tag='section' class='content-section'>
        <GridContainer @tag='header' class='section-header'>
          <h2>Dark Mode Variables (.dark)</h2>
          <SectionToggleButton
            @expanded={{this.isDarkVariablesVisible}}
            @onToggle={{this.toggleDarkVariables}}
            aria-controls='dark-variables-content'
          />
        </GridContainer>
        {{#if this.isDarkVariablesVisible}}
          <div
            id='dark-variables-content'
            class='section-body'
            data-test-dark-vars
          >
            <@fields.darkModeVariables />
          </div>
        {{/if}}
      </GridContainer>

      <GridContainer @tag='section' class='content-section'>
        <GridContainer @tag='header' class='section-header'>
          <h2>CSS Imports</h2>
          <SectionToggleButton
            @expanded={{this.areCSSImportsVisible}}
            @onToggle={{this.toggleCSSImports}}
            aria-controls='css-imports-content'
          />
        </GridContainer>
        {{#if this.areCSSImportsVisible}}
          <div id='css-imports-content' class='section-body'>
            {{#if @model.cssImports}}
              <@fields.cssImports />
            {{else}}
              <em>None</em>
            {{/if}}
          </div>
        {{/if}}
      </GridContainer>

      <GridContainer @tag='section' class='content-section'>
        <GridContainer @tag='header' class='section-header'>
          <h2>Calculated CSS Variables</h2>
          <SectionToggleButton
            @expanded={{this.isGeneratedCSSVisible}}
            @onToggle={{this.toggleGeneratedCSS}}
            aria-controls='generated-css-content'
          />
        </GridContainer>
        {{#if this.isGeneratedCSSVisible}}
          <div
            id='generated-css-content'
            class='section-body'
            data-test-css-vars
          >
            <div class='generates-css-container'>
              <CopyButton
                class='copy-css-variables-button'
                @textToCopy={{@model.cssVariables}}
              />
              <@fields.cssVariables />
            </div>
          </div>
        {{/if}}
      </GridContainer>
    </GridContainer>

    <style scoped>
      .structured-theme-card {
        min-height: 100%;
        align-content: start;
        gap: 0;
        container-name: structured-theme-card;
        container-type: inline-size;
      }

      .content-section {
        padding: var(--boxel-sp) var(--boxel-sp-xxl);
      }

      .section-header {
        grid-template-columns: 1fr auto;
        align-items: center;
      }

      .section-body {
        animation: fade-in 120ms ease-out;
      }

      .css-textarea {
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
      }

      .generates-css-container {
        position: relative;
      }
      .copy-css-variables-button {
        position: absolute;
        top: 0;
        right: 0;
        color: var(--primary);
      }

      @keyframes fade-in {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @container structured-theme-card (width < 31.25rem) {
        .content-section {
          padding: var(--boxel-sp-xs);
        }
        .field-list {
          grid-template-columns: 1fr 1fr;
        }
        h2 {
          font-size: var(--boxel-font-size);
        }
      }
    </style>
  </template>
}

export default class StructuredTheme extends Theme {
  static displayName = 'Structured Theme';

  @field typography = contains(ThemeTypographyField, {
    description:
      'Typography styles for headings, body, and captions whose values are emitted as theme CSS variables.',
  });
  @field rootVariables = contains(ThemeVarField, {
    description:
      '`:root {}` variables for default (light mode) theme. CSS variable names are the dasherized and lowercase version of the field names, prefixed with "--".',
  });
  @field darkModeVariables = contains(ThemeVarField, {
    description:
      '`.dark {}` variables for dark mode theme. CSS variable names are the dasherized and lowercase version of the field names, prefixed with "--".',
  });

  // CSS Variables computed from field entries
  @field cssVariables = contains(CSSField, {
    computeVia: function (this: StructuredTheme) {
      if (!generateCssVariables || !buildCssGroups) {
        return;
      }
      let rootRules = mergeRuleMaps(
        this.rootVariables?.cssRuleMap,
        this.typography?.cssRuleMap,
      );
      let darkRules = mergeRuleMaps(
        this.darkModeVariables?.cssRuleMap,
        this.typography?.cssRuleMap,
      );
      return generateCssVariables(
        buildCssGroups([
          { selector: ':root', rules: rootRules },
          { selector: '.dark', rules: darkRules },
        ]),
      );
    },
  });

  static isolated: BaseDefComponent = Isolated;
}
