import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import {
  BoxelButton,
  BoxelContainer,
  GridContainer,
  BoxelInput,
} from '@cardstack/boxel-ui/components';
import {
  buildCssGroups,
  generateCssVariables,
  parseCssGroups,
  type CssRuleMap,
} from '@cardstack/boxel-ui/helpers';

import {
  field,
  contains,
  Component,
  CSSField,
  Theme,
  type BaseDefComponent,
} from './card-api';
import ThemeVarField from './structured-theme-variables';

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
  @tracked isGeneratedCSSVisible = true;
  @tracked isRootVariablesVisible = true;
  @tracked isDarkVariablesVisible = true;
  @tracked isCssTextareaVisible = true;

  @action toggleGeneratedCSSVisibility() {
    this.isGeneratedCSSVisible = !this.isGeneratedCSSVisible;
  }

  @action toggleRootVariablesVisibility() {
    this.isRootVariablesVisible = !this.isRootVariablesVisible;
  }

  @action toggleDarkVariablesVisibility() {
    this.isDarkVariablesVisible = !this.isDarkVariablesVisible;
  }

  @action toggleCssTextareaVisibility() {
    this.isCssTextareaVisible = !this.isCssTextareaVisible;
  }

  @action parseCss(content: string) {
    if (!content) {
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
          <h2>CSS Variables</h2>
          <BoxelButton
            @kind='text-only'
            @size='extra-small'
            class='section-toggle'
            aria-expanded={{this.isCssTextareaVisible}}
            aria-controls='css-variables-content'
            {{on 'click' this.toggleCssTextareaVisibility}}
          >
            {{if this.isCssTextareaVisible 'Hide' 'Show'}}
          </BoxelButton>
        </GridContainer>
        {{#if this.isCssTextareaVisible}}
          <div id='css-variables-content' class='section-body'>
            <BoxelInput @type='textarea' @onInput={{this.parseCss}} />
          </div>
        {{/if}}
      </GridContainer>

      <GridContainer @tag='section' class='content-section'>
        <GridContainer @tag='header' class='section-header'>
          <h2>Root Variables (:root)</h2>
          <BoxelButton
            @kind='text-only'
            @size='extra-small'
            class='section-toggle'
            aria-expanded={{this.isRootVariablesVisible}}
            aria-controls='root-variables-content'
            {{on 'click' this.toggleRootVariablesVisibility}}
          >
            {{if this.isRootVariablesVisible 'Hide' 'Show'}}
          </BoxelButton>
        </GridContainer>
        {{#if this.isRootVariablesVisible}}
          <div id='root-variables-content' class='section-body'>
            <@fields.rootVariables />
          </div>
        {{/if}}
      </GridContainer>

      <GridContainer @tag='section' class='content-section'>
        <GridContainer @tag='header' class='section-header'>
          <h2>Dark Mode Variables (.dark)</h2>
          <BoxelButton
            @kind='text-only'
            @size='extra-small'
            class='section-toggle'
            aria-expanded={{this.isDarkVariablesVisible}}
            aria-controls='dark-variables-content'
            {{on 'click' this.toggleDarkVariablesVisibility}}
          >
            {{if this.isDarkVariablesVisible 'Hide' 'Show'}}
          </BoxelButton>
        </GridContainer>
        {{#if this.isDarkVariablesVisible}}
          <div id='dark-variables-content' class='section-body'>
            <@fields.darkModeVariables />
          </div>
        {{/if}}
      </GridContainer>

      <GridContainer @tag='section' class='content-section'>
        <GridContainer @tag='header' class='section-header'>
          <h2>All CSS Variables</h2>
          <BoxelButton
            @kind='text-only'
            @size='extra-small'
            class='section-toggle'
            aria-expanded={{this.isGeneratedCSSVisible}}
            aria-controls='generated-css-content'
            {{on 'click' this.toggleGeneratedCSSVisibility}}
          >
            {{if this.isGeneratedCSSVisible 'Hide' 'Show'}}
          </BoxelButton>
        </GridContainer>
        {{#if this.isGeneratedCSSVisible}}
          <div
            id='generated-css-content'
            class='section-body'
            data-test-css-vars
          >
            <@fields.cssVariables />
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
        font-weight: var(--boxel-font-weight-semibold);
      }

      h1 {
        font-size: var(--boxel-font-size-xl);
        line-height: var(--boxel-line-height-xl);
      }

      h2 {
        font-size: var(--boxel-font-size-lg);
        line-height: var(--boxel-line-height-lg);
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

      .section-toggle {
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xxxs);
        color: var(--primary);
        background: transparent;
        border: none;
        text-transform: uppercase;
      }

      .section-toggle:hover,
      .section-toggle:focus-visible {
        text-decoration: underline;
      }

      .section-body {
        animation: fade-in 120ms ease-out;
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
          font-size: var(--boxel-font-size-med);
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
