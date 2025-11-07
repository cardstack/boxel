import TrendingUpIcon from '@cardstack/boxel-icons/trending-up';
import CubeIcon from '@cardstack/boxel-icons/cube';
import NumberField from '../fields/number';

import {
  CardDef,
  field,
  contains,
  type BaseDefConstructor,
  type Field,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { getField } from '@cardstack/runtime-common';

export class NumberFieldsPreview extends CardDef {
  static displayName = 'Number Fields Preview';
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
        showValue: true,
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
        suffix: '',
        min: 0,
        max: 100,
        label: 'Total Revenue',
        subtitle: '↑ 12.5% vs last month',
        placeholder: '$0.00',
        icon: TrendingUpIcon,
      },
    },
  });

  // Badge field
  @field badgeNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'badge',
        decimals: 0,
        min: 0,
        max: 100,
        label: 'Items',
        icon: CubeIcon,
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

  // Gauge field
  @field gaugeNumber = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'gauge',
        min: 0,
        max: 100,
        suffix: '%',
        label: 'CPU Usage',
        warningThreshold: 70,
        dangerThreshold: 90,
      },
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='number-fields-preview'>
        <header class='header'>
          <h1 class='title'>Number Fields Showcase</h1>
          <p class='subtitle'>Comprehensive preview of all number field types
            with configurations</p>
        </header>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>1. Default Number Field</h2>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Change the value below</p>
              <@fields.basicNumber @format='edit' />

            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.basicNumber @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.basicNumber @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>2. Slider Field</h2>
            <p class='section-description'>Visual slider representation with
              percentage fill</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Change the value below</p>
              <@fields.sliderNumber @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.sliderNumber @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.sliderNumber @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>3. Rating Field</h2>
            <p class='section-description'>Star-based rating system</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Change the value below</p>
              <@fields.ratingNumber @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.ratingNumber @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.ratingNumber @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>4. Quantity Field</h2>
            <p class='section-description'>Display quantity with label</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Change the value below</p>
              <@fields.quantityNumber @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.quantityNumber @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.quantityNumber @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>5. Percentage Field</h2>
            <p class='section-description'>Percentage with visual bar
              representation</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Change the value below</p>
              <@fields.percentageNumber @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.percentageNumber @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.percentageNumber @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>6. Stat Field</h2>
            <p class='section-description'>Statistic display with label and
              optional prefix/suffix</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Change the value below</p>
              <@fields.statNumber @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.statNumber @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.statNumber @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>7. Badge Field</h2>
            <p class='section-description'>Badge-style number display with
              optional label</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Change the value below</p>
              <@fields.badgeNumber @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.badgeNumber @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.badgeNumber @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>8. Scores Field</h2>
            <p class='section-description'>Score display with colored bars</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Change the value below</p>
              <@fields.scoresNumber @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.scoresNumber @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.scoresNumber @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>9. Progress Bar Field</h2>
            <p class='section-description'>Horizontal progress bar with
              percentage</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Change the value below</p>
              <@fields.progressBarNumber @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.progressBarNumber @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.progressBarNumber @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>10. Progress Circle Field</h2>
            <p class='section-description'>Circular progress indicator</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Change the value below</p>
              <@fields.progressCircleNumber @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.progressCircleNumber @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.progressCircleNumber @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class='field-section'>
          <div class='section-header'>
            <h2 class='section-title'>11. Gauge Field</h2>
            <p class='section-description'>Gauge display with thresholds</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Change the value below</p>
              <@fields.gaugeNumber @format='edit' />
            </div>
            <div class='display-column'>
              <div class='column-header'>Display View</div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Atom:</p>
                  <div class='field-box'>
                    <@fields.gaugeNumber @format='atom' />
                  </div>
                </div>
              </div>
              <div class='display-group'>
                <div class='display-item'>
                  <p>Embedded:</p>
                  <@fields.gaugeNumber @format='embedded' />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <style scoped>
        .number-fields-preview {
          max-width: 1400px;
          margin: 0 auto;
          padding: var(--boxel-sp-xxl);
          background: var(--boxel-light);
        }

        .header {
          margin-bottom: var(--boxel-sp-xxxl);
          padding-bottom: var(--boxel-sp-lg);
          border-bottom: 2px solid var(--boxel-200);
        }

        .title {
          font-size: 2.5rem;
          font-weight: 700;
          color: var(--boxel-dark);
          margin: 0 0 var(--boxel-sp-xs);
          font-family: var(--boxel-font-family);
          letter-spacing: -0.02em;
        }

        .subtitle {
          font-size: 1.125rem;
          color: var(--boxel-450);
          margin: 0;
          font-family: var(--boxel-font-family);
        }

        .field-section {
          margin-bottom: var(--boxel-sp-xxl);
          padding: var(--boxel-sp-xxl);
          background: white;
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }

        .section-header {
          margin-bottom: var(--boxel-sp-xxl);
          padding-bottom: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--boxel-100);
        }

        .section-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--boxel-dark);
          margin: 0 0 var(--boxel-sp-xs);
          font-family: var(--boxel-font-family);
          letter-spacing: -0.01em;
        }

        .section-description {
          font-size: 0.9375rem;
          color: var(--boxel-450);
          margin: 0;
          font-family: var(--boxel-font-family);
        }

        .field-layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: var(--boxel-sp-xxl);
          margin-bottom: var(--boxel-sp-lg);
        }

        .edit-column,
        .display-column {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
        }

        .edit-column {
          padding: var(--boxel-sp-lg);
          background: var(--boxel-light);
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius);
        }

        .display-column {
          padding: var(--boxel-sp-lg);
          background: var(--boxel-purple-100);
          border: 1px solid var(--boxel-purple-300);
          border-radius: var(--boxel-border-radius);
        }

        .column-header {
          font-size: 1.125rem;
          font-weight: 700;
          color: var(--boxel-dark);
          margin: 0 0 var(--boxel-sp-xxxs);
          font-family: var(--boxel-font-family);
        }

        .edit-column .column-subtitle {
          font-size: 0.875rem;
          color: var(--boxel-450);
          margin: 0 0 var(--boxel-sp);
          font-family: var(--boxel-font-family);
        }

        .display-column .column-subtitle {
          font-size: 0.875rem;
          color: var(--boxel-450);
          margin: 0 0 var(--boxel-sp);
          font-family: var(--boxel-font-family);
        }

        .field-box {
          padding: var(--boxel-sp);
          background: white;
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius);
          min-height: 60px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .display-group {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
        }

        .display-item {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxxs);
        }

        .display-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--boxel-500);
          font-family: var(--boxel-font-family);
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
