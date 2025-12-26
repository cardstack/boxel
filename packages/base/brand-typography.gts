import { FieldContainer, GridContainer } from '@cardstack/boxel-ui/components';

import { Component } from './card-api';
import {
  ThemeTypographyField,
  calculateTypographyVariables,
  type CssVariableFieldEntry,
} from './structured-theme-variables';

export default class BrandTypography extends ThemeTypographyField {
  static displayName = 'Brand Typography';

  static embedded = class Embedded extends Component<typeof BrandTypography> {
    <template>
      <GridContainer class='preview-grid'>
        <FieldContainer
          class='preview-container'
          @vertical={{true}}
          @label='Headline'
        >
          <div class='preview-field'>
            <p>{{@model.heading.styleSummary}}</p>
            <@fields.heading class='typography-preview' />
          </div>
        </FieldContainer>
        <FieldContainer
          class='preview-container'
          @vertical={{true}}
          @label='Body'
        >
          <div class='preview-field'>
            <p>{{@model.body.styleSummary}}</p>
            <@fields.body class='typography-preview' />
          </div>
        </FieldContainer>
      </GridContainer>

      <section class='theme-typography'>
        <h1>
          {{#if @model.heading.sampleText}}
            {{@model.heading.sampleText}}
          {{else}}
            Sample Heading (H1)
          {{/if}}
        </h1>
        <h2>
          {{#if @model.sectionHeading.sampleText}}
            {{@model.sectionHeading.sampleText}}
          {{else}}
            Sample Section Heading (H2)
          {{/if}}
        </h2>
        <h3>
          {{#if @model.subheading.sampleText}}
            {{@model.subheading.sampleText}}
          {{else}}
            Sample Subheading (H3)
          {{/if}}
        </h3>
        <p>
          {{#if @model.body.sampleText}}
            {{@model.body.sampleText}}
          {{else}}
            Sample body text.
          {{/if}}
        </p>
        <small>
          {{#if @model.caption.sampleText}}
            {{@model.caption.sampleText}}
          {{else}}
            Small text
          {{/if}}
        </small>
      </section>

      <style scoped>
        .preview-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
        }
        .preview-container {
          gap: 0;
        }
        .preview-field {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        p {
          margin-block: 0;
        }
        .typography-preview {
          display: flex;
          align-items: center;
          justify-content: center;
          max-width: 100%;
          min-height: 11.25rem; /* 180px */
          background-color: var(--muted, var(--boxel-100));
          color: var(--foreground, var(--boxel-dark));
          border-radius: var(--boxel-border-radius);
          text-align: center;
          overflow: hidden;
        }
        .theme-typography {
          margin-top: var(--boxel-sp-3xl);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
        }
        .theme-typography h1,
        .theme-typography h2,
        .theme-typography h3,
        .theme-typography h4,
        .theme-typography h5,
        .theme-typography h6,
        .theme-typography p {
          margin: 0;
        }
      </style>
    </template>
  };

  get cssVariableFields(): CssVariableFieldEntry[] | undefined {
    let cssVariableFields = calculateTypographyVariables(this, 'brand');
    return cssVariableFields;
  }
}
