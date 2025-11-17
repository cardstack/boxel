import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import {
  BoxelButton,
  GridContainer,
  BoxelInput,
  CopyButton,
  FieldContainer,
  ContextButton,
  Accordion,
  Header,
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
import CardInfoTemplates from './default-templates/card-info';

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
  @tracked isCssTextareaVisible = false;
  @tracked isRootVariablesVisible = true;
  @tracked isDarkVariablesVisible = false;
  @tracked areCSSImportsVisible = false;
  @tracked isGeneratedCSSVisible = false;

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
  --background: 0 0% 100%;
  --foreground: oklch(0.52 0.13 144.17);
  --primary: #3e2723;
  /* ... */
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: hsl(37.50 36.36% 95.69%);
  --primary: rgb(46, 125, 50);
  /* ... */
}`;

  <template>
    <GridContainer @tag='article' class='structured-theme-card'>
      <Header class='card-info-header'>
        <CardInfoTemplates.view
          @title={{@model.title}}
          @description={{@model.description}}
          @thumbnailURL={{@model.thumbnailURL}}
          @icon={{@model.constructor.icon}}
        />
      </Header>

      <GridContainer @tag='section' class='content-section'>
        <div>
          <BoxelButton
            class='import-button'
            @kind='primary'
            @size='small'
            {{on 'click' this.toggleCssTextarea}}
          >
            Import CSS
          </BoxelButton>
        </div>
        {{#if this.isCssTextareaVisible}}
          <div class='css-textarea-section'>
            <ContextButton
              class='css-textarea-close-button'
              @label='Close CSS Textarea'
              @icon='close'
              @variant='ghost'
              @size='extra-small'
              {{on 'click' this.toggleCssTextarea}}
            />
            <FieldContainer @vertical={{true}} @label='Import CSS' @tag='label'>
              <BoxelInput
                id='css-textarea'
                @type='textarea'
                @onInput={{this.parseCss}}
                @placeholder={{this.cssPlaceholder}}
                class='css-textarea'
                data-test-custom-css-variables
              />
            </FieldContainer>
          </div>
        {{/if}}

        <Accordion as |A|>
          <A.Item
            @isOpen={{this.isRootVariablesVisible}}
            @onClick={{this.toggleRootVariables}}
            @id='root-variables-content'
          >
            <:title><span class='section-title'>Root Variables (:root)</span></:title>
            <:content>
              <div class='section-content' data-test-root-vars>
                <@fields.rootVariables />
              </div>
            </:content>
          </A.Item>
          <A.Item
            @isOpen={{this.isDarkVariablesVisible}}
            @onClick={{this.toggleDarkVariables}}
            @id='dark-variables-content'
          >
            <:title><span class='section-title'>Dark Mode Variables (.dark)</span></:title>
            <:content>
              <div class='section-content' data-test-dark-vars>
                <@fields.darkModeVariables />
              </div>
            </:content>
          </A.Item>
          <A.Item
            @isOpen={{this.isGeneratedCSSVisible}}
            @onClick={{this.toggleGeneratedCSS}}
            @id='generated-css-content'
          >
            <:title><span class='section-title'>CSS Variables</span></:title>
            <:content>
              <div class='section-content generated-css-content'>
                <CopyButton
                  class='copy-css-variables-button'
                  @textToCopy={{@model.cssVariables}}
                />
                <div class='generated-css'>
                  <@fields.cssVariables />
                </div>
              </div>
            </:content>
          </A.Item>
          <A.Item
            @isOpen={{this.areCSSImportsVisible}}
            @onClick={{this.toggleCSSImports}}
            @id='css-imports-content'
          >
            <:title><span class='section-title'>CSS Imports</span></:title>
            <:content>
              <div class='section-content'>
                {{#if @model.cssImports}}
                  <@fields.cssImports />
                {{else}}
                  <em>None</em>
                {{/if}}
              </div>
            </:content>
          </A.Item>
        </Accordion>
      </GridContainer>
    </GridContainer>

    <style scoped>
      .structured-theme-card {
        min-height: 100%;
        align-content: start;
        gap: 0;
      }

      .card-info-header {
        --boxel-header-min-height: 9.375rem; /* 150px */
        --boxel-header-padding: var(--boxel-sp-xxl) var(--boxel-sp-xl)
          var(--boxel-sp-xl);
        --boxel-header-gap: var(--boxel-sp-lg);
        --boxel-header-border-color: var(--hr-color);
        align-items: flex-start;
        background-color: var(--muted, var(--boxel-100));
      }
      .card-info-header :deep(.info) {
        align-self: center;
      }

      .section-title {
        font-size: var(--boxel-font-size);
        line-height: var(--boxel-lineheight);
        font-weight: var(--boxel-font-weight-medium);
      }

      .content-section {
        padding: var(--boxel-sp-xxl);
        gap: var(--boxel-sp-xl);
      }
      .section-content {
        padding-bottom: var(--boxel-sp);
      }

      .css-textarea-section {
        position: relative;
      }
      .css-textarea-close-button {
        position: absolute;
        top: 0;
        right: 0;
      }
      .css-textarea {
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
      }

      .generated-css-content {
        position: relative;
      }
      .generated-css-section {
        background-color: var(--muted);
        color: var(--muted-foreground);
      }
      .copy-css-variables-button {
        position: absolute;
        top: var(--boxel-sp-xs);
        right: var(--boxel-sp-xs);
        opacity: 0.5;
      }
      .copy-css-variables-button:hover {
        opacity: 1;
      }
      .generated-css {
        height: 50cqmin;
        border-radius: var(--radius);
        overflow: auto;
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
