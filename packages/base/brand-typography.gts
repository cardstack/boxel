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
      </style>
    </template>
  };

  get cssVariableFields(): CssVariableFieldEntry[] | undefined {
    let cssVariableFields = calculateTypographyVariables(this, 'brand');
    return cssVariableFields;
  }
}
