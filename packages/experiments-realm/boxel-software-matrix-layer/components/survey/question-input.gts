import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import GlimmerComponent from '@glimmer/component';
import { eq } from '@cardstack/boxel-ui/helpers';
import type { SurveyQuestion } from '../../survey-question';

// Plain inputs styled after boxel-surface cell-chrome.css; no surface Cell/context machinery, so the listing stays self-contained.

interface QuestionInputSignature {
  Args: {
    question: SurveyQuestion;
    value: unknown;
    onChange: (value: unknown) => void;
    autofocus?: boolean;
    invalid?: boolean;
  };
  Element: HTMLElement;
}

const RATING_SCALE = [1, 2, 3, 4, 5];

export default class QuestionInput extends GlimmerComponent<QuestionInputSignature> {
  get options(): string[] {
    return (this.args.question.options as string[] | undefined) ?? [];
  }

  get selectedMulti(): string[] {
    return Array.isArray(this.args.value) ? (this.args.value as string[]) : [];
  }

  get ratingValue(): number {
    return typeof this.args.value === 'number' ? this.args.value : 0;
  }

  get textValue(): string {
    return typeof this.args.value === 'string' ? this.args.value : '';
  }

  isChecked = (option: string): boolean => {
    return this.selectedMulti.includes(option);
  };

  isStarOn = (star: number): boolean => {
    return star <= this.ratingValue;
  };

  @action
  updateText(event: Event) {
    this.args.onChange((event.target as HTMLInputElement).value);
  }

  @action
  toggleMulti(option: string) {
    let current = this.selectedMulti;
    let next = current.includes(option)
      ? current.filter((o) => o !== option)
      : [...current, option];
    this.args.onChange(next);
  }

  @action
  setRating(value: number) {
    this.args.onChange(this.ratingValue === value ? 0 : value);
  }

  <template>
    <div class='qi {{if @invalid "is-invalid"}}' ...attributes>
      {{#if (eq @question.kind 'short-text')}}
        <input
          class='qi-input'
          type='text'
          value={{this.textValue}}
          placeholder='Your answer'
          autofocus={{@autofocus}}
          {{on 'input' this.updateText}}
        />

      {{else if (eq @question.kind 'long-text')}}
        <textarea
          class='qi-input qi-textarea'
          rows='4'
          placeholder='Your answer'
          autofocus={{@autofocus}}
          {{on 'input' this.updateText}}
        >{{this.textValue}}</textarea>

      {{else if (eq @question.kind 'single-choice')}}
        <div class='qi-choices' role='radiogroup'>
          {{#each this.options as |option|}}
            <button
              type='button'
              class='qi-choice {{if (eq @value option) "is-selected"}}'
              role='radio'
              aria-checked={{if (eq @value option) 'true' 'false'}}
              {{on 'click' (fn @onChange option)}}
            >
              <span class='qi-mark qi-mark--radio'></span>
              <span class='qi-choice-label'>{{option}}</span>
            </button>
          {{/each}}
        </div>

      {{else if (eq @question.kind 'multi-choice')}}
        <div class='qi-choices'>
          {{#each this.options as |option|}}
            <button
              type='button'
              class='qi-choice {{if (this.isChecked option) "is-selected"}}'
              aria-pressed={{if (this.isChecked option) 'true' 'false'}}
              {{on 'click' (fn this.toggleMulti option)}}
            >
              <span class='qi-mark qi-mark--check'></span>
              <span class='qi-choice-label'>{{option}}</span>
            </button>
          {{/each}}
        </div>

      {{else if (eq @question.kind 'rating')}}
        <div class='qi-rating' role='radiogroup'>
          {{#each RATING_SCALE as |star|}}
            <button
              type='button'
              class='qi-star {{if (this.isStarOn star) "is-on"}}'
              aria-label='{{star}} of 5'
              {{on 'click' (fn this.setRating star)}}
            >★</button>
          {{/each}}
        </div>

      {{else if (eq @question.kind 'yes-no')}}
        <div class='qi-yesno'>
          <button
            type='button'
            class='qi-toggle {{if (eq @value true) "is-selected"}}'
            {{on 'click' (fn @onChange true)}}
          >Yes</button>
          <button
            type='button'
            class='qi-toggle {{if (eq @value false) "is-selected"}}'
            {{on 'click' (fn @onChange false)}}
          >No</button>
        </div>

      {{else}}
        <input
          class='qi-input'
          type='text'
          value={{this.textValue}}
          placeholder='Your answer'
          {{on 'input' this.updateText}}
        />
      {{/if}}
    </div>

    <style scoped>
      .qi {
        --qi-accent: var(--primary, var(--boxel-highlight));
      }
      .qi.is-invalid .qi-input,
      .qi.is-invalid .qi-mark,
      .qi.is-invalid .qi-choice,
      .qi.is-invalid .qi-toggle {
        border-color: var(--destructive, var(--boxel-danger));
      }
      .qi.is-invalid .qi-star {
        color: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 45%,
          var(--background, var(--boxel-light))
        );
      }
      .qi-input {
        width: 100%;
        box-sizing: border-box;
        min-height: var(--boxel-form-control-height, 2.5rem);
        padding: 0.5rem 0.75rem;
        font: inherit;
        color: var(--foreground, var(--boxel-dark));
        background: var(--card, var(--boxel-light));
        border: 1px solid var(--border, var(--boxel-300));
        border-radius: var(--boxel-border-radius-sm, 0.5rem);
        transition:
          border-color 0.15s ease,
          box-shadow 0.15s ease;
      }
      .qi-input:focus {
        outline: 0;
        border-color: var(--qi-accent);
        box-shadow: 0 0 0 3px
          color-mix(in srgb, var(--qi-accent) 22%, transparent);
      }
      .qi-textarea {
        resize: vertical;
        line-height: 1.45;
      }

      .qi-choices {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .qi-choice {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        width: 100%;
        padding: 0.55rem 0.75rem;
        font: inherit;
        text-align: start;
        color: var(--foreground, var(--boxel-dark));
        background: var(--card, var(--boxel-light));
        border: 1px solid var(--border, var(--boxel-300));
        border-radius: var(--boxel-border-radius-sm, 0.5rem);
        cursor: pointer;
        transition:
          border-color 0.15s ease,
          background 0.15s ease;
      }
      .qi-choice:hover {
        border-color: var(--qi-accent);
      }
      .qi-choice.is-selected {
        border-color: var(--qi-accent);
        background: color-mix(in srgb, var(--qi-accent) 10%, transparent);
      }
      .qi-mark {
        flex-shrink: 0;
        width: 1.1rem;
        height: 1.1rem;
        border: 2px solid var(--border, var(--boxel-300));
        background: var(--card, var(--boxel-light));
        position: relative;
      }
      .qi-mark--radio {
        border-radius: 50%;
      }
      .qi-mark--check {
        border-radius: 0.3rem;
      }
      .qi-choice.is-selected .qi-mark {
        border-color: var(--qi-accent);
        background: var(--qi-accent);
      }
      .qi-choice.is-selected .qi-mark::after {
        content: '';
        position: absolute;
        inset: 0;
        margin: auto;
      }
      .qi-choice.is-selected .qi-mark--radio::after {
        width: 0.45rem;
        height: 0.45rem;
        border-radius: 50%;
        background: var(--primary-foreground, var(--boxel-light));
      }
      .qi-choice.is-selected .qi-mark--check::after {
        width: 0.28rem;
        height: 0.55rem;
        border: solid var(--primary-foreground, var(--boxel-light));
        border-width: 0 2px 2px 0;
        transform: translateY(-1px) rotate(45deg);
      }

      .qi-rating {
        display: inline-flex;
        gap: 0.25rem;
      }
      .qi-star {
        font-size: 1.6rem;
        line-height: 1;
        padding: 0.1rem;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--border, var(--boxel-300));
        transition: color 0.12s ease;
      }
      .qi-star.is-on {
        color: var(--boxel-warning);
      }

      .qi-yesno {
        display: inline-flex;
        gap: 0.5rem;
      }
      .qi-toggle {
        min-width: 4.5rem;
        min-height: var(--boxel-form-control-height, 2.5rem);
        padding-inline: 1rem;
        font: inherit;
        font-weight: 600;
        color: var(--foreground, var(--boxel-dark));
        background: var(--card, var(--boxel-light));
        border: 1px solid var(--border, var(--boxel-300));
        border-radius: var(--boxel-border-radius-sm, 0.5rem);
        cursor: pointer;
        transition:
          border-color 0.15s ease,
          background 0.15s ease;
      }
      .qi-toggle.is-selected {
        border-color: var(--qi-accent);
        background: var(--qi-accent);
        color: var(--primary-foreground, var(--boxel-light));
      }
    </style>
  </template>
}
