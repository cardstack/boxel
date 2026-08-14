import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import GlimmerComponent from '@glimmer/component';
import { eq, lt, add } from '@cardstack/boxel-ui/helpers';

// Stepper chrome + CSS ported from boxel-surface FormWizard; driven by args (no surface runtime) so the listing stays self-contained.

export interface WizardStep {
  label: string;
}

interface FormWizardSignature {
  Args: {
    steps: WizardStep[];
    activeIndex: number;
    canAdvance?: boolean;
    nextLabel?: string;
    previousLabel?: string;
    finishLabel?: string;
    onSelect: (index: number) => void;
    onPrevious: () => void;
    onNext: () => void;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

export default class FormWizard extends GlimmerComponent<FormWizardSignature> {
  get isFirst(): boolean {
    return this.args.activeIndex <= 0;
  }
  get isLast(): boolean {
    return this.args.activeIndex >= this.args.steps.length - 1;
  }
  get canAdvance(): boolean {
    return this.args.canAdvance !== false;
  }
  get nextLabel(): string {
    return this.args.nextLabel ?? 'Continue';
  }
  get previousLabel(): string {
    return this.args.previousLabel ?? 'Back';
  }
  get finishLabel(): string {
    return this.args.finishLabel ?? 'Finish';
  }

  <template>
    <div class='bx-form-wizard' data-bx-form-wizard ...attributes>
      <ol class='bx-form-wizard__steps'>
        {{#each @steps as |step index|}}
          <li class='bx-form-wizard__step-item'>
            <button
              class='bx-form-wizard__step'
              type='button'
              aria-current={{if (eq index @activeIndex) 'step'}}
              data-bx-form-wizard-step-active={{if
                (eq index @activeIndex)
                'true'
                'false'
              }}
              data-bx-form-wizard-step-complete={{if
                (lt index @activeIndex)
                'true'
                'false'
              }}
              {{on 'click' (fn @onSelect index)}}
            >
              <span class='bx-form-wizard__step-index'>{{add index 1}}</span>
              <span class='bx-form-wizard__step-label'>{{step.label}}</span>
            </button>
          </li>
        {{/each}}
      </ol>

      <div class='bx-form-wizard__panels'>
        {{yield}}
      </div>

      <div class='bx-form-wizard__footer'>
        <button
          class='bx-form-wizard__button bx-form-wizard__button--secondary'
          type='button'
          disabled={{this.isFirst}}
          {{on 'click' @onPrevious}}
        >
          {{this.previousLabel}}
        </button>
        <button
          class='bx-form-wizard__button bx-form-wizard__button--primary'
          type='button'
          disabled={{if this.canAdvance false true}}
          {{on 'click' @onNext}}
        >
          {{if this.isLast this.finishLabel this.nextLabel}}
        </button>
      </div>
    </div>

    <style scoped>
      .bx-form-wizard {
        display: grid;
        gap: var(--boxel-sp);
        min-width: 0;
        container-type: inline-size;
        container-name: bx-form-wizard;
      }

      .bx-form-wizard__steps {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
        gap: var(--boxel-sp-xs);
        padding: 0;
        margin: 0;
        list-style: none;
      }

      .bx-form-wizard__step {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        width: 100%;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm, 0.375rem);
        background: var(--card, var(--boxel-light));
        color: var(--card-foreground, var(--boxel-dark));
        font: inherit;
        text-align: start;
        cursor: pointer;
      }

      .bx-form-wizard__step[data-bx-form-wizard-step-active='true'] {
        border-color: var(--ring, var(--boxel-highlight));
        box-shadow: 0 0 0 var(--boxel-sp-5xs, 2px)
          var(--ring, var(--boxel-highlight));
      }

      .bx-form-wizard__step[data-bx-form-wizard-step-complete='true'] {
        background: var(--secondary, var(--boxel-100));
        color: var(--secondary-foreground, var(--boxel-dark));
      }

      .bx-form-wizard__step:focus {
        outline: 0;
        box-shadow: 0 0 0 var(--boxel-sp-5xs, 2px)
          var(--ring, var(--boxel-highlight));
      }

      .bx-form-wizard__step-index {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: calc(var(--boxel-sp, 1rem) + var(--boxel-sp-xs, 0.5rem));
        height: calc(var(--boxel-sp, 1rem) + var(--boxel-sp-xs, 0.5rem));
        border-radius: var(--boxel-border-radius-xs, 0.25rem);
        background: var(--muted, var(--boxel-100));
        color: var(--muted-foreground, var(--boxel-450));
        font-size: var(--boxel-caption-font-size, 0.75rem);
        font-weight: 600;
      }

      .bx-form-wizard__step[data-bx-form-wizard-step-active='true']
        .bx-form-wizard__step-index {
        background: var(--ring, var(--boxel-highlight));
        color: var(--primary-foreground, var(--boxel-light));
      }

      .bx-form-wizard__step-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .bx-form-wizard__panels {
        min-width: 0;
      }

      .bx-form-wizard__footer {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
        padding-block-start: var(--boxel-sp-sm);
        border-block-start: 1px solid
          var(--hr-color, var(--border, var(--boxel-200)));
      }

      .bx-form-wizard__button {
        min-height: var(--boxel-form-control-height, 2.5rem);
        padding-inline: var(--boxel-sp, 1rem);
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm, 0.375rem);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      .bx-form-wizard__button--primary {
        background: var(--primary, var(--boxel-highlight));
        color: var(--primary-foreground, var(--boxel-light));
        border-color: transparent;
      }

      .bx-form-wizard__button--secondary {
        background: var(--secondary, var(--boxel-100));
        color: var(--secondary-foreground, var(--boxel-dark));
      }

      .bx-form-wizard__button:focus {
        outline: 0;
        box-shadow: 0 0 0 var(--boxel-sp-5xs, 2px)
          var(--ring, var(--boxel-highlight));
      }

      .bx-form-wizard__button:disabled {
        color: var(--muted-foreground, var(--boxel-450));
        cursor: not-allowed;
        opacity: 0.6;
      }

      @container bx-form-wizard (max-width: 36rem) {
        .bx-form-wizard__steps {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}
