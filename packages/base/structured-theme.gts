import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import {
  BoxelButton,
  BoxelContainer,
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
import ThemeVarField from './structured-theme-variables';

interface SectionToggleSignature {
  Args: {
    expanded: boolean;
    onToggle: (event: Event) => void;
  };
  Element: HTMLButtonElement;
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
const applyCssRulesToField = (
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
      <BoxelContainer @tag='header' @display='flex' class='theme-header'>
        <h1><@fields.title /></h1>
        <p class='theme-description'>
          <@fields.description />
        </p>
      </BoxelContainer>

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
      p {
        margin: 0;
      }

      h1,
      h2 {
        margin: 0;
      }

      h1 {
        font-size: var(--boxel-heading-font-size);
        line-height: var(--boxel-heading-line-height);
      }

      h2 {
        font-size: var(--boxel-font-size-md);
        font-weight: 500;
        line-height: var(--boxel-line-height-md);
      }

      .structured-theme-card {
        min-height: 100%;
        align-content: start;
        gap: 0;
        container-name: structured-theme-card;
        container-type: inline-size;
      }

      .theme-header {
        min-height: 20vh;
        flex-direction: column;
        flex-wrap: nowrap;
        justify-content: center;
        padding: var(--boxel-sp-xxl);
        gap: var(--boxel-sp-xs);
        text-align: center;
        background-color: var(--card);
        color: var(--card-foreground);
      }

      .theme-description {
        color: var(--muted-foreground);
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
      return generateCssVariables(
        buildCssGroups([
          { selector: ':root', rules: this.rootVariables?.cssRuleMap },
          { selector: '.dark', rules: this.darkModeVariables?.cssRuleMap },
        ]),
      );
    },
  });

  static isolated: BaseDefComponent = Isolated;
}
