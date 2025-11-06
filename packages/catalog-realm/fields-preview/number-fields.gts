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

  static isolated = class Isolated extends Component<typeof this> {
    get basicNumberConfig() {
      return `@field basicNumber = contains(NumberField);`;
    }

    get sliderNumberConfig() {
      return `@field sliderNumber = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'slider',
      min: 0,
      max: 100,
      suffix: '%'
    }
  }
});`;
    }

    get ratingNumberConfig() {
      return `@field ratingNumber = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'rating',
      maxStars: 5
    }
  }
});`;
    }

    get quantityNumberConfig() {
      return `@field quantityNumber = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'quantity',
      min: 0,
      max: 999
    }
  }
});`;
    }

    get percentageNumberConfig() {
      return `@field percentageNumber = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'percentage',
      min: 0,
      max: 200
    }
  }
});`;
    }

    get statNumberConfig() {
      return `@field statNumber = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'stat',
      prefix: '+',
      suffix: '',
      min: 0,
      max: 100
    }
  }
});`;
    }

    get badgeNumberConfig() {
      return `@field badgeNumber = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'badge',
      label: 'NEW',
      decimals: 0,
      min: 0,
      max: 100
    }
  }
});`;
    }

    get scoresNumberConfig() {
      return `@field scoresNumber = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'scores',
      decimals: 0,
      min: 0,
      max: 1000
    }
  }
});`;
    }

    get progressBarNumberConfig() {
      return `@field progressBarNumber = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'progress-bar',
      min: 0,
      max: 100,
      label: 'Completion'
    }
  }
});`;
    }

    get progressCircleNumberConfig() {
      return `@field progressCircleNumber = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'progress-circle',
      min: 0,
      max: 100
    }
  }
});`;
    }

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
            <p class='section-description'>Standard number display with optional
              prefix, suffix, and decimal configuration</p>
          </div>
          <div class='field-layout'>
            <div class='edit-column'>
              <div class='column-header'>Edit Mode</div>
              <p class='column-subtitle'>Change the value below</p>
              <div class='field-box'>
                <@fields.basicNumber @format='edit' />
              </div>
            </div>
            <div class='display-column'>
              <div class='column-header'>Atom View</div>
              <p class='column-subtitle'>See how it renders</p>
              <div class='display-group'>
                <div class='display-item'>
                  <div class='field-box'>
                    <@fields.basicNumber @format='atom' />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class='config-details'>
            <div class='config-header'>Configuration Code</div>
            <pre class='config-code'><code
              >{{this.basicNumberConfig}}</code></pre>
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
              <div class='field-box'>
                <@fields.sliderNumber @format='edit' />
              </div>
            </div>
            <div class='display-column'>
              <div class='column-header'>Atom View</div>
              <p class='column-subtitle'>See how it renders</p>
              <div class='display-group'>
                <div class='display-item'>
                  <div class='field-box'>
                    <@fields.sliderNumber @format='atom' />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class='config-details'>
            <div class='config-header'>Configuration Code</div>
            <pre class='config-code'><code
              >{{this.sliderNumberConfig}}</code></pre>
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
              <div class='field-box'>
                <@fields.ratingNumber @format='edit' />
              </div>
            </div>
            <div class='display-column'>
              <div class='column-header'>Atom View</div>
              <p class='column-subtitle'>See how it renders</p>
              <div class='display-group'>
                <div class='display-item'>
                  <div class='field-box'>
                    <@fields.ratingNumber @format='atom' />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class='config-details'>
            <div class='config-header'>Configuration Code</div>
            <pre class='config-code'><code
              >{{this.ratingNumberConfig}}</code></pre>
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
              <div class='field-box'>
                <@fields.quantityNumber @format='edit' />
              </div>
            </div>
            <div class='display-column'>
              <div class='column-header'>Atom View</div>
              <p class='column-subtitle'>See how it renders</p>
              <div class='display-group'>
                <div class='display-item'>
                  <div class='field-box'>
                    <@fields.quantityNumber @format='atom' />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class='config-details'>
            <div class='config-header'>Configuration Code</div>
            <pre class='config-code'><code
              >{{this.quantityNumberConfig}}</code></pre>
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
              <div class='field-box'>
                <@fields.percentageNumber @format='edit' />
              </div>
            </div>
            <div class='display-column'>
              <div class='column-header'>Atom View</div>
              <p class='column-subtitle'>See how it renders</p>
              <div class='display-group'>
                <div class='display-item'>
                  <div class='field-box'>
                    <@fields.percentageNumber @format='atom' />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class='config-details'>
            <div class='config-header'>Configuration Code</div>
            <pre class='config-code'><code
              >{{this.percentageNumberConfig}}</code></pre>
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
              <div class='field-box'>
                <@fields.statNumber @format='edit' />
              </div>
            </div>
            <div class='display-column'>
              <div class='column-header'>Atom View</div>
              <p class='column-subtitle'>See how it renders</p>
              <div class='display-group'>
                <div class='display-item'>
                  <div class='field-box'>
                    <@fields.statNumber @format='atom' />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class='config-details'>
            <div class='config-header'>Configuration Code</div>
            <pre class='config-code'><code
              >{{this.statNumberConfig}}</code></pre>
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
              <div class='field-box'>
                <@fields.badgeNumber @format='edit' />
              </div>
            </div>
            <div class='display-column'>
              <div class='column-header'>Atom View</div>
              <p class='column-subtitle'>See how it renders</p>
              <div class='display-group'>
                <div class='display-item'>
                  <div class='field-box'>
                    <@fields.badgeNumber @format='atom' />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class='config-details'>
            <div class='config-header'>Configuration Code</div>
            <pre class='config-code'><code
              >{{this.badgeNumberConfig}}</code></pre>
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
              <div class='field-box'>
                <@fields.scoresNumber @format='edit' />
              </div>
            </div>
            <div class='display-column'>
              <div class='column-header'>Atom View</div>
              <p class='column-subtitle'>See how it renders</p>
              <div class='display-group'>
                <div class='display-item'>
                  <div class='field-box'>
                    <@fields.scoresNumber @format='atom' />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class='config-details'>
            <div class='config-header'>Configuration Code</div>
            <pre class='config-code'><code
              >{{this.scoresNumberConfig}}</code></pre>
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
              <div class='field-box'>
                <@fields.progressBarNumber @format='edit' />
              </div>
            </div>
            <div class='display-column'>
              <div class='column-header'>Atom View</div>
              <p class='column-subtitle'>See how it renders</p>
              <div class='display-group'>
                <div class='display-item'>
                  <div class='field-box'>
                    <@fields.progressBarNumber @format='atom' />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class='config-details'>
            <div class='config-header'>Configuration Code</div>
            <pre class='config-code'><code
              >{{this.progressBarNumberConfig}}</code></pre>
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
              <div class='field-box'>
                <@fields.progressCircleNumber @format='edit' />
              </div>
            </div>
            <div class='display-column'>
              <div class='column-header'>Atom View</div>
              <p class='column-subtitle'>See how it renders</p>
              <div class='display-group'>
                <div class='display-item'>
                  <div class='field-box'>
                    <@fields.progressCircleNumber @format='atom' />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class='config-details'>
            <div class='config-header'>Configuration Code</div>
            <pre class='config-code'><code
              >{{this.progressCircleNumberConfig}}</code></pre>
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
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp-xxl);
          margin-bottom: var(--boxel-sp-lg);
        }

        @media (max-width: 900px) {
          .field-layout {
            grid-template-columns: 1fr;
          }
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
          padding: var(--boxel-sp-lg);
          background: white;
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius);
          min-height: 80px;
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

        .config-details {
          margin-top: var(--boxel-sp-xl);
          padding-top: var(--boxel-sp-lg);
          border-top: 1px solid var(--boxel-100);
        }

        .config-header {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--boxel-purple);
          margin-bottom: var(--boxel-sp-sm);
          font-family: var(--boxel-font-family);
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xxxs);
        }

        .config-header::before {
          content: '<>';
          font-size: 1rem;
          font-weight: 700;
        }

        .config-code {
          margin: 0;
          padding: var(--boxel-sp-lg);
          background: #1e1e1e;
          border: 1px solid #333;
          border-radius: var(--boxel-border-radius);
          overflow-x: auto;
          overflow-y: hidden;
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .config-code code {
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 0.8125rem;
          color: #d4d4d4;
          line-height: 1.6;
          white-space: pre;
          display: block;
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
