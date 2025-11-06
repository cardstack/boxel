import NumberField from '../fields/number';

import {
  CardDef,
  field,
  contains,
  type BaseDefConstructor,
  type Field,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { getField } from '@cardstack/runtime-common';

export class NumberFieldsPreview extends CardDef {
  // Basic number field (default - no type specified)
  @field basicNumber = contains(NumberField);

  // Slider field
  @field sliderNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'slider',
        min: 0,
        max: 100,
        suffix: '%',
      },
    },
  });

  // Rating field
  @field ratingNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'rating',
        maxStars: 5,
      },
    },
  });

  // Quantity field
  @field quantityNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'quantity',
        min: 0,
        max: 999,
      },
    },
  });

  // Percentage field
  @field percentageNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'percentage',
        min: 0,
        max: 200,
      },
    },
  });

  // Stat field
  @field statNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'stat',
        prefix: '+',
        suffix: 'k',
        min: 0,
        max: 100,
      },
    },
  });

  // Badge field
  @field badgeNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'badge',
        label: 'NEW',
        decimals: 0,
        min: 0,
        max: 100,
      },
    },
  });

  // Scores field
  @field scoresNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'scores',
        decimals: 0,
        min: 0,
        max: 1000,
      },
    },
  });

  // Progress bar field
  @field progressBarNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'progress-bar',
        min: 0,
        max: 100,
        label: 'Completion',
      },
    },
  });

  // Progress circle field
  @field progressCircleNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'progress-circle',
        min: 0,
        max: 100,
      },
    },
  });

  static displayName = 'Number Fields Preview';

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='number-fields-preview'>
        <h1 class='title'>Number Fields Showcase</h1>
        <p class='subtitle'>Comprehensive preview of all number field types with
          configurations</p>

        <section class='field-section'>
          <h2 class='section-title'>1. Default Number Field</h2>
          <p class='section-description'>Standard number display with optional
            prefix, suffix, and decimal configuration</p>
          <div class='field-grid'>
            <FieldContainer @label='Basic (Default)' @vertical={{true}}>
              <div class='format-label'>Edit</div>
              <div class='preview-box'>
                <@fields.basicNumber @format='edit' />
              </div>
              <div class='format-label'>Atom</div>
              <div class='preview-box'>
                <@fields.basicNumber @format='atom' />
              </div>
              <div class='format-label'>Embedded</div>
              <div class='preview-box'>
                <@fields.basicNumber @format='embedded' />
              </div>
            </FieldContainer>
          </div>
        </section>

        <section class='field-section'>
          <h2 class='section-title'>2. Slider Field</h2>
          <p class='section-description'>Visual slider representation with
            percentage fill</p>
          <div class='field-grid'>
            <FieldContainer @label='Slider (75/100)' @vertical={{true}}>
              <div class='config-badge'>type: "slider" | min: 0 | max: 100 |
                showValue: true</div>
              <div class='format-label'>Edit</div>
              <div class='preview-box wide'>
                <@fields.sliderNumber @format='edit' />
              </div>
              <div class='format-label'>Atom</div>
              <div class='preview-box'>
                <@fields.sliderNumber @format='atom' />
              </div>
              <div class='format-label'>Embedded</div>
              <div class='preview-box wide'>
                <@fields.sliderNumber @format='embedded' />
              </div>
            </FieldContainer>
          </div>
        </section>

        <section class='field-section'>
          <h2 class='section-title'>3. Rating Field</h2>
          <p class='section-description'>Star-based rating system</p>
          <div class='field-grid'>
            <FieldContainer @label='Rating (4/5 stars)' @vertical={{true}}>
              <div class='config-badge'>type: "rating" | maxStars: 5</div>
              <div class='format-label'>Edit</div>
              <div class='preview-box'>
                <@fields.ratingNumber @format='edit' />
              </div>
              <div class='format-label'>Atom</div>
              <div class='preview-box'>
                <@fields.ratingNumber @format='atom' />
              </div>
              <div class='format-label'>Embedded</div>
              <div class='preview-box'>
                <@fields.ratingNumber @format='embedded' />
              </div>
            </FieldContainer>
          </div>
        </section>

        <section class='field-section'>
          <h2 class='section-title'>4. Quantity Field</h2>
          <p class='section-description'>Display quantity with label</p>
          <div class='field-grid'>
            <FieldContainer @label='Quantity (12 items)' @vertical={{true}}>
              <div class='config-badge'>type: "quantity" | min: 0 | max: 999</div>
              <div class='format-label'>Edit</div>
              <div class='preview-box'>
                <@fields.quantityNumber @format='edit' />
              </div>
              <div class='format-label'>Atom</div>
              <div class='preview-box'>
                <@fields.quantityNumber @format='atom' />
              </div>
              <div class='format-label'>Embedded</div>
              <div class='preview-box'>
                <@fields.quantityNumber @format='embedded' />
              </div>
            </FieldContainer>
          </div>
        </section>

        <section class='field-section'>
          <h2 class='section-title'>5. Percentage Field</h2>
          <p class='section-description'>Percentage with visual bar
            representation</p>
          <div class='field-grid'>
            <FieldContainer @label='Percentage (67.5%)' @vertical={{true}}>
              <div class='config-badge'>type: "percentage" | decimals: 1 | min:
                0 | max: 100</div>
              <div class='format-label'>Edit</div>
              <div class='preview-box'>
                <@fields.percentageNumber @format='edit' />
              </div>
              <div class='format-label'>Atom</div>
              <div class='preview-box'>
                <@fields.percentageNumber @format='atom' />
              </div>
              <div class='format-label'>Embedded</div>
              <div class='preview-box wide'>
                <@fields.percentageNumber @format='embedded' />
              </div>
            </FieldContainer>
          </div>
        </section>

        <section class='field-section'>
          <h2 class='section-title'>6. Stat Field</h2>
          <p class='section-description'>Statistic display with label and
            optional prefix/suffix</p>
          <div class='field-grid'>
            <FieldContainer
              @label='Stat (+1250 Total Users)'
              @vertical={{true}}
            >
              <div class='config-badge'>type: "stat" | prefix: "+" | label:
                "Total Users" | decimals: 0</div>
              <div class='format-label'>Edit</div>
              <div class='preview-box'>
                <@fields.statNumber @format='edit' />
              </div>
              <div class='format-label'>Atom</div>
              <div class='preview-box'>
                <@fields.statNumber @format='atom' />
              </div>
              <div class='format-label'>Embedded</div>
              <div class='preview-box'>
                <@fields.statNumber @format='embedded' />
              </div>
            </FieldContainer>
          </div>
        </section>

        <section class='field-section'>
          <h2 class='section-title'>7. Badge Field</h2>
          <p class='section-description'>Badge-style number display with
            optional label</p>
          <div class='field-grid'>
            <FieldContainer @label='Badge (NEW 42)' @vertical={{true}}>
              <div class='config-badge'>type: "badge" | label: "NEW" | decimals:
                0</div>
              <div class='format-label'>Edit</div>
              <div class='preview-box'>
                <@fields.badgeNumber @format='edit' />
              </div>
              <div class='format-label'>Atom</div>
              <div class='preview-box'>
                <@fields.badgeNumber @format='atom' />
              </div>
              <div class='format-label'>Embedded</div>
              <div class='preview-box'>
                <@fields.badgeNumber @format='embedded' />
              </div>
            </FieldContainer>
          </div>
        </section>

        <section class='field-section'>
          <h2 class='section-title'>8. Scores Field</h2>
          <p class='section-description'>Score display with colored bars</p>
          <div class='field-grid'>
            <FieldContainer @label='Scores (850)' @vertical={{true}}>
              <div class='config-badge'>type: "scores" | decimals: 0</div>
              <div class='format-label'>Edit</div>
              <div class='preview-box'>
                <@fields.scoresNumber @format='edit' />
              </div>
              <div class='format-label'>Atom</div>
              <div class='preview-box'>
                <@fields.scoresNumber @format='atom' />
              </div>
              <div class='format-label'>Embedded</div>
              <div class='preview-box'>
                <@fields.scoresNumber @format='embedded' />
              </div>
            </FieldContainer>
          </div>
        </section>

        <section class='field-section'>
          <h2 class='section-title'>9. Progress Bar Field</h2>
          <p class='section-description'>Horizontal progress bar with percentage</p>
          <div class='field-grid'>
            <FieldContainer @label='Progress Bar (65%)' @vertical={{true}}>
              <div class='config-badge'>type: "progress-bar" | min: 0 | max: 100
                | label: "Completion"</div>
              <div class='format-label'>Edit</div>
              <div class='preview-box'>
                <@fields.progressBarNumber @format='edit' />
              </div>
              <div class='format-label'>Atom</div>
              <div class='preview-box'>
                <@fields.progressBarNumber @format='atom' />
              </div>
              <div class='format-label'>Embedded</div>
              <div class='preview-box wide'>
                <@fields.progressBarNumber @format='embedded' />
              </div>
            </FieldContainer>
          </div>
        </section>

        <section class='field-section'>
          <h2 class='section-title'>10. Progress Circle Field</h2>
          <p class='section-description'>Circular progress indicator</p>
          <div class='field-grid'>
            <FieldContainer @label='Progress Circle (80%)' @vertical={{true}}>
              <div class='config-badge'>type: "progress-circle" | min: 0 | max:
                100</div>
              <div class='format-label'>Edit</div>
              <div class='preview-box'>
                <@fields.progressCircleNumber @format='edit' />
              </div>
              <div class='format-label'>Atom</div>
              <div class='preview-box'>
                <@fields.progressCircleNumber @format='atom' />
              </div>
              <div class='format-label'>Embedded</div>
              <div class='preview-box'>
                <@fields.progressCircleNumber @format='embedded' />
              </div>
            </FieldContainer>
          </div>
        </section>
      </div>

      <style scoped>
        .number-fields-preview {
          max-width: 1200px;
          margin: 0 auto;
          padding: var(--boxel-sp-xl);
          background: var(--background, white);
        }

        .title {
          font-size: 2.5rem;
          font-weight: 700;
          color: var(--foreground, var(--boxel-dark));
          margin: 0 0 var(--boxel-sp-xs);
        }

        .subtitle {
          font-size: 1.125rem;
          color: var(--muted-foreground, var(--boxel-450));
          margin: 0 0 var(--boxel-sp-xxl);
        }

        .field-section {
          margin-bottom: var(--boxel-sp-xxl);
          padding-bottom: var(--boxel-sp-xxl);
          border-bottom: 2px solid var(--border, var(--boxel-border));
        }

        .field-section:last-of-type {
          border-bottom: none;
        }

        .section-title {
          font-size: 1.75rem;
          font-weight: 600;
          color: var(--primary, var(--boxel-purple));
          margin: 0 0 var(--boxel-sp-xs);
        }

        .section-description {
          font-size: 1rem;
          color: var(--muted-foreground, var(--boxel-450));
          margin: 0 0 var(--boxel-sp-lg);
        }

        .field-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
          gap: var(--boxel-sp-lg);
        }

        .format-label {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-500));
          margin-top: var(--boxel-sp-sm);
          margin-bottom: var(--boxel-sp-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .preview-box {
          padding: var(--boxel-sp-lg);
          background: var(--muted, var(--boxel-100));
          border: 1px solid var(--border, var(--boxel-border));
          border-radius: var(--boxel-border-radius);
          min-height: 60px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .preview-box.wide {
          min-width: 300px;
        }

        .config-badge {
          display: inline-block;
          padding: var(--boxel-sp-xxxs) var(--boxel-sp-xs);
          background: var(--accent, var(--boxel-highlight));
          color: var(--accent-foreground, white);
          border-radius: var(--boxel-border-radius-sm);
          font-size: 0.75rem;
          font-weight: 600;
          font-family: var(--font-mono, monospace);
          margin-bottom: var(--boxel-sp-sm);
        }
      </style>
    </template>

    getFieldIcon = (key: string) => {
      const field: Field<BaseDefConstructor> | undefined = getField(
        this.args.model.constructor!,
        key,
      );
      let fieldInstance = field?.card;
      return fieldInstance?.icon;
    };
  };
}
