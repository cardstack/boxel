// Pretui — AgentQuestion: a question the agent is waiting on, answered in place.
import Component from '@glimmer/component';
import { StateGlyph } from './state-glyph';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { cssStyle } from '../pretui-css';

export interface AgentQuestionSignature {
  Args: {
    question: string;
    options?: string[];
    /** richer answers than words: the real things to pick between. Each
     * settles the question with its label */
    choices?: AgentChoice[];
    /** how @choices are drawn: 'cards' (a tile with an optional image and a
     * line under the label) or 'swatches' (a colour chip and its name).
     * Default 'cards' */
    layout?: 'cards' | 'swatches';
    /** the free answer's placeholder. Default 'Or type an answer…' */
    otherLabel?: string;
    answered?: string;
    onAnswer?: (answer: string) => void;
    /** the question, without its answers: a read-only transcript or a
     * teammate's request */
    readonly?: boolean;
    /** false: a closed set, the given options only, with no free answer
     * (a server that validates option ids). Default true */
    freeAnswer?: boolean;
    /** the answer is on its way: every option waits */
    pending?: boolean;
    /** a choice is picked first, then confirmed, so a stray tap on a card or
     * a swatch never answers. Pills and the free answer still settle at once */
    confirm?: boolean;
  };
  Blocks: {
    /** a choice's own content, drawn above its label in place of its image:
     * a live card, a rendered preview */
    choice: [AgentChoice];
  };
  Element: HTMLDivElement;
}

export interface AgentChoice {
  label: string;
  /** what the answer reports when it differs from the label: an id, a URL,
   * a colour. Default the label */
  value?: string;
  /** a quieter line under the label: "Headlamps, city lights" */
  sub?: string;
  /** an image for a card choice */
  image?: string;
  /** a CSS colour for a swatch choice */
  swatch?: string;
}

// a swatch is agent-supplied, so it is validated as one CSS value before it
// reaches the style attribute; a rejected value draws no colour
const swatchStyle = (choice: AgentChoice) => cssStyle('--swatch', choice.swatch);

const choiceValue = (choice: AgentChoice) => choice.value ?? choice.label;

// ASK verb: option pills + free answer; settles to a quiet answered line.
export class AgentQuestion extends Component<AgentQuestionSignature> {
  /** the reader's own answer, before the caller reports it back */
  @tracked private localPicked?: string;
  /** the settled answer: the caller's `@answered` wins, so a question that
   * is answered elsewhere (a teammate's, a read-only transcript) settles
   * when the answer arrives */
  get picked(): string | undefined {
    return this.args.answered ?? this.localPicked;
  }
  /** the choice picked but not yet confirmed (with @confirm) */
  @tracked selected?: AgentChoice;
  /** the settled answer as words: a choice's label, not its value */
  get pickedLabel(): string | undefined {
    let picked = this.picked;
    let choice = this.args.choices?.find((c) => choiceValue(c) === picked);
    return choice?.label ?? picked;
  }
  get confirmLabel(): string {
    let choice = this.selected;
    if (!choice) {
      return this.args.layout === 'swatches' ? 'Pick a colour' : 'Pick one';
    }
    return this.args.layout === 'swatches'
      ? `Use ${choice.label}`
      : `Choose ${choice.label}`;
  }
  isSelected = (choice: AgentChoice) => this.selected === choice;
  pick = (choice: AgentChoice) => {
    if (this.args.readonly || this.args.pending) {
      return;
    }
    if (this.args.confirm) {
      this.selected = choice;
      return;
    }
    this.settle(choiceValue(choice));
  };
  confirmPick = () => {
    if (this.selected) {
      this.settle(choiceValue(this.selected));
    }
  };
  get offersFreeAnswer() {
    return this.args.freeAnswer !== false;
  }
  settle = (value: string) => {
    if (this.args.readonly || this.args.pending) {
      return;
    }
    this.localPicked = value;
    this.args.onAnswer?.(value);
  };
  onKey = (e: Event) => {
    let ev = e as KeyboardEvent;
    let input = ev.target as HTMLInputElement;
    if (ev.key === 'Enter' && input.value) {
      this.settle(input.value);
    }
  };
  <template>
    {{#if this.picked}}
      <div
        class='pretui-answered'
        data-test-pretui-agent-question
        ...attributes
      >
        <StateGlyph class='pretui-answered-check' @glyph='done' />
        {{@question}}
        <b>{{this.pickedLabel}}</b>
      </div>
    {{else}}
      <div
        class='pretui-question'
        aria-busy={{if @pending 'true'}}
        data-pending={{if @pending 'true'}}
        data-test-pretui-agent-question
        ...attributes
      >
        <div class='pretui-question-text'>{{@question}}</div>
        {{#if @readonly}}
          <p
            class='pretui-question-readonly'
            data-test-pretui-agent-question-readonly
          >Waiting for an answer</p>
        {{else}}
          {{#if @options.length}}
            <div class='pretui-question-opts'>
              {{#each @options as |option|}}
                <button
                  type='button'
                  class='pretui-qpill'
                  {{on 'click' (fn this.settle option)}}
                >{{option}}</button>
              {{/each}}
            </div>
          {{/if}}
          {{#if @choices.length}}
            <div
              class='pretui-question-choices'
              data-layout={{if @layout @layout 'cards'}}
              data-test-pretui-agent-choices
            >
              {{#each @choices as |choice|}}
                <button
                  type='button'
                  class='pretui-qchoice'
                  style={{swatchStyle choice}}
                  aria-pressed={{if
                    @confirm
                    (if (this.isSelected choice) 'true' 'false')
                  }}
                  {{on 'click' (fn this.pick choice)}}
                  data-test-pretui-agent-choice={{choice.label}}
                >
                  {{#if (has-block 'choice')}}
                    <span class='pretui-qchoice-content'>{{yield
                        choice
                        to='choice'
                      }}</span>
                  {{else if choice.image}}<img
                      class='pretui-qchoice-image'
                      src={{choice.image}}
                      alt=''
                      data-test-pretui-agent-choice-image
                    />{{/if}}
                  {{#if choice.swatch}}<span
                      class='pretui-qchoice-swatch'
                      aria-hidden='true'
                      data-test-pretui-agent-choice-swatch
                    ></span>{{/if}}
                  <span class='pretui-qchoice-label'>{{choice.label}}</span>
                  {{#if choice.sub}}<span
                      class='pretui-qchoice-sub'
                    >{{choice.sub}}</span>{{/if}}
                </button>
              {{/each}}
            </div>
            {{#if @confirm}}
              <button
                type='button'
                class='pretui-qconfirm'
                disabled={{if this.selected false true}}
                {{on 'click' this.confirmPick}}
                data-test-pretui-agent-confirm
              >{{this.confirmLabel}}</button>
            {{/if}}
          {{/if}}
          {{#if this.offersFreeAnswer}}
            <input
              class='pretui-qinput'
              aria-label='Answer'
              placeholder={{if @otherLabel @otherLabel 'Or type an answer…'}}
              disabled={{@pending}}
              {{on 'keydown' this.onKey}}
            />
          {{/if}}
        {{/if}}
      </div>
    {{/if}}
    <style scoped>
      @layer PretComponent {
        .pretui-question {
          display: grid;
          gap: var(--boxel-sp-xs);
        }
        /* the question is the agent speaking: reading size, its weight the
           one step up */
        .pretui-question-text {
          font-size: var(--boxel-body-font-size);
          line-height: var(--boxel-body-line-height);
          font-weight: 600;
          color: var(--foreground);
        }
        .pretui-question-opts {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        /* a quick answer: outlined and quiet, so no one option shouts */
        .pretui-qpill {
          display: inline-flex;
          align-items: center;
          height: 1.75rem;
          padding: 0 var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius-sm);
          border: 0;
          background-color: transparent;
          box-shadow: inset 0 0 0 1px var(--border);
          font-family: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 400;
          cursor: pointer;
          color: var(--foreground);
        }
        .pretui-qpill:hover {
          background-color: var(--hover);
          box-shadow: inset 0 0 0 1px var(--border-strong);
        }
        .pretui-qpill:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* the real things to pick between: tiles for cards, chips for
           colours; a choice is one button, its label the answer */
        .pretui-question-choices {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
          gap: var(--boxel-sp-xs);
        }
        .pretui-question-choices[data-layout='swatches'] {
          grid-template-columns: repeat(auto-fill, minmax(5.25rem, 1fr));
        }
        .pretui-qchoice {
          display: grid;
          align-content: start;
          gap: var(--boxel-sp-6xs);
          min-width: 0;
          padding: var(--boxel-sp-xs);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: transparent;
          box-shadow: inset 0 0 0 1px var(--border);
          font-family: inherit;
          text-align: start;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-qchoice:hover {
          background-color: var(--hover);
          box-shadow: inset 0 0 0 1px var(--border-strong);
        }
        .pretui-qchoice:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        /* picked, waiting for Confirm: outlined in ink-1 */
        .pretui-qchoice[aria-pressed='true'] {
          box-shadow: inset 0 0 0 2px var(--foreground);
        }
        .pretui-qchoice-content {
          display: block;
          height: var(--pretui-qchoice-content-h, 6rem);
          margin-bottom: var(--boxel-sp-4xs);
          overflow: hidden;
          border-radius: var(--boxel-border-radius-xs);
          pointer-events: none;
        }
        /* Confirm is the one answer: the moment's primary */
        .pretui-qconfirm {
          justify-self: start;
          height: 1.75rem;
          padding: 0 var(--boxel-sp-sm);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: var(--primary);
          color: var(--primary-foreground);
          font-family: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 600;
          cursor: pointer;
        }
        .pretui-qconfirm:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .pretui-qconfirm:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-qchoice-image {
          display: block;
          width: 100%;
          aspect-ratio: 16 / 10;
          margin-bottom: var(--boxel-sp-4xs);
          border-radius: var(--boxel-border-radius-xs);
          background-color: var(--inset);
          object-fit: cover;
        }
        .pretui-qchoice-swatch {
          display: block;
          height: 1.375rem;
          margin-bottom: var(--boxel-sp-4xs);
          border-radius: var(--boxel-border-radius-xs);
          background-color: var(--swatch, var(--muted));
          box-shadow: inset 0 0 0 1px var(--border);
        }
        .pretui-qchoice-label {
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-qchoice-sub {
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--muted-foreground);
        }
        /* sent, waiting on the agent: the options step down to ink-3 and
           take no more presses */
        .pretui-question[data-pending] .pretui-qpill,
        .pretui-question[data-pending] .pretui-qchoice {
          color: var(--subtle-foreground);
          pointer-events: none;
        }
        .pretui-question-readonly {
          margin: 0;
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--muted-foreground);
        }
        .pretui-qinput {
          display: flex;
          align-items: center;
          height: 1.75rem;
          padding: 0 var(--boxel-sp-xs);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          font-family: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          color: var(--foreground);
          background-color: var(--field);
          box-shadow: inset 0 0 0 1px var(--input);
          width: 100%;
        }
        .pretui-qinput::placeholder {
          color: var(--subtle-foreground);
        }
        .pretui-qinput:focus {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* answered: done is ink with a check, the answer in ink-1 */
        .pretui-answered {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          color: var(--muted-foreground);
        }
        .pretui-answered-check {
          color: var(--foreground);
        }
        .pretui-answered b {
          color: var(--foreground);
          font-weight: 600;
        }
      }
    </style>
  </template>
}
