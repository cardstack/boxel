// Pretui — AiInstructions: the editable standing instructions an agent follows, switched off rather than deleted.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { concat, fn } from '@ember/helper';
import { Button } from './button';
import { Input } from './input';
import { Switch } from './switch';
import { EmptyState } from './empty-state';

// ── AiInstructions ───────────────────────────────────────────────────────
// Standing instructions are the part of an agent's behaviour a person can
// actually edit, so the surface has to make three things easy: read what is
// in force, switch one off without losing it, and add another.
//
// Switching off rather than deleting is the design decision worth naming.
// An instruction you disabled is a decision you can revisit; an instruction
// you deleted is one you will re-type from memory next week. Remove exists,
// but the switch is the primary verb, which is why it is first in the row.

export interface AiInstruction {
  /** stable id — the {{#each}} key and the callback subject */
  id: string;
  /** the instruction itself */
  text: string;
  /** whether it is currently in force (default true) */
  enabled?: boolean;
  /** optional provenance line, e.g. 'from the workspace skill' */
  note?: string;
}

export interface AiInstructionsSignature {
  Args: {
    /** the instruction set, in the order it should read */
    instructions: AiInstruction[];
    /** heading (default 'Instructions') */
    title?: string;
    /** one line under the heading */
    description?: string;
    /** fires with the trimmed text of a new instruction */
    onAdd?: (text: string) => void;
    /** fires when an instruction is switched on or off */
    onToggle?: (instruction: AiInstruction, enabled: boolean) => void;
    /** fires when an instruction is removed */
    onRemove?: (instruction: AiInstruction) => void;
    /** how many are allowed; shows a '3 of 10' counter and blocks the add */
    max?: number;
    /** placeholder for the add field */
    placeholder?: string;
    /** what the empty shelf says */
    emptyMessage?: string;
  };
  Element: HTMLElement;
}

export class AiInstructions extends Component<AiInstructionsSignature> {
  @tracked private draft = '';

  get instructions(): AiInstruction[] {
    return this.args.instructions ?? [];
  }
  get title(): string {
    return this.args.title ?? 'Instructions';
  }
  get enabledCount(): number {
    return this.instructions.filter((i) => i.enabled !== false).length;
  }
  get atLimit(): boolean {
    return this.args.max !== undefined && this.instructions.length >= this.args.max;
  }
  get counter(): string | undefined {
    if (this.args.max === undefined) {
      return this.instructions.length === 1
        ? '1 instruction'
        : this.instructions.length + ' instructions';
    }
    return this.instructions.length + ' of ' + this.args.max;
  }
  /** announced politely so switching one off is audible, not only visible */
  get liveSummary(): string {
    let total = this.instructions.length;
    if (total === 0) {
      return 'No instructions';
    }
    return this.enabledCount + ' of ' + total + ' instructions in force';
  }
  /** helper line shown only once the shelf is full */
  get limitHint(): string | undefined {
    return this.atLimit ? 'Limit reached' : undefined;
  }
  get canAdd(): boolean {
    return !this.atLimit && this.draft.trim().length > 0;
  }
  get rows(): (AiInstruction & { enabledNow: boolean })[] {
    return this.instructions.map((instruction) => ({
      ...instruction,
      enabledNow: instruction.enabled !== false,
    }));
  }

  setDraft = (value: string) => (this.draft = value);

  add = (event: Event) => {
    event.preventDefault();
    let text = this.draft.trim();
    if (!text || this.atLimit) {
      return;
    }
    this.args.onAdd?.(text);
    this.draft = '';
  };

  toggle = (instruction: AiInstruction, enabled: boolean) =>
    this.args.onToggle?.(instruction, enabled);

  remove = (instruction: AiInstruction) => this.args.onRemove?.(instruction);

  <template>
    <section
      class='pretui-instr'
      aria-label={{this.title}}
      data-test-pretui-ai-instructions
      ...attributes
    >
      <header class='pretui-instr-head'>
        <h3 class='pretui-instr-title'>{{this.title}}</h3>
        {{#if this.counter}}
          <span class='pretui-instr-count'>{{this.counter}}</span>
        {{/if}}
      </header>
      {{#if @description}}
        <p class='pretui-instr-desc'>{{@description}}</p>
      {{/if}}

      <span class='pretui-sr' role='status'>{{this.liveSummary}}</span>

      {{#if this.rows.length}}
        <ul class='pretui-instr-list'>
          {{#each this.rows key='id' as |row|}}
            <li class='pretui-instr-row' data-off={{unless row.enabledNow 'true'}}>
              <Switch
                @checked={{row.enabledNow}}
                @onCheckedChange={{fn this.toggle row}}
                aria-label={{concat 'In force: ' row.text}}
                data-test-pretui-ai-instructions-switch
              />
              <span class='pretui-instr-body'>
                <span class='pretui-instr-text'>{{row.text}}</span>
                {{#if row.note}}
                  <span class='pretui-instr-note'>{{row.note}}</span>
                {{/if}}
                {{#unless row.enabledNow}}
                  {{! state is never colour alone — the word says it too }}
                  <span class='pretui-instr-off'>off</span>
                {{/unless}}
              </span>
              {{#if @onRemove}}
                <button
                  type='button'
                  class='pretui-instr-remove'
                  aria-label={{concat 'Remove instruction: ' row.text}}
                  data-test-pretui-ai-instructions-remove
                  {{on 'click' (fn this.remove row)}}
                >
                  <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
                    <path
                      d='M18 6L6 18M6 6l12 12'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2.2'
                      stroke-linecap='round'
                    />
                  </svg>
                </button>
              {{/if}}
            </li>
          {{/each}}
        </ul>
      {{else}}
        <EmptyState
          @title='No standing instructions'
          @message={{if
            @emptyMessage
            @emptyMessage
            'Anything you add here is sent with every message in this session.'
          }}
        />
      {{/if}}

      {{#if @onAdd}}
        <form class='pretui-instr-add' {{on 'submit' this.add}}>
          <Input
            @value={{this.draft}}
            @onInput={{this.setDraft}}
            @placeholder={{if
              @placeholder
              @placeholder
              'Add an instruction…'
            }}
            @disabled={{if this.atLimit true}}
            @helperText={{this.limitHint}}
            class='pretui-instr-field'
            aria-label='New instruction'
            data-test-pretui-ai-instructions-field
          />
          <Button
            @size='s'
            @disabled={{unless this.canAdd true}}
            type='submit'
            data-test-pretui-ai-instructions-add
          >Add</Button>
        </form>
      {{/if}}
    </section>

    <style scoped>
      .pretui-instr {
        display: flex;
        flex-direction: column;
        gap: var(--space-3, 9px);
        padding: var(--space-4, 13px);
        border-radius: var(--radius-surface, 14px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-card,
          0 0 0 1px var(--border),
          0 1px 2px rgb(0 0 0 / 0.08)
        );
        font-size: var(--text-ui-md, 12.5px);
        container-type: inline-size;
      }
      .pretui-instr-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
      }
      .pretui-instr-title {
        margin: 0;
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .pretui-instr-count {
        flex: none;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--ink-3, var(--boxel-400));
        font-variant-numeric: tabular-nums;
      }
      .pretui-instr-desc {
        margin: 0;
        max-width: 62ch;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
      .pretui-instr-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pretui-instr-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        min-height: 34px;
        padding: 7px 8px;
        border-radius: 8px;
      }
      .pretui-instr-row:hover {
        background: var(--inset, var(--boxel-100));
      }
      .pretui-instr-body {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .pretui-instr-text {
        line-height: 1.5;
      }
      .pretui-instr-row[data-off] .pretui-instr-text {
        color: var(--muted-foreground);
        text-decoration: line-through;
        text-decoration-color: var(--ink-3, var(--boxel-400));
      }
      .pretui-instr-note {
        font-size: var(--text-ui-xs, 11px);
        color: var(--ink-3, var(--boxel-400));
      }
      .pretui-instr-off {
        align-self: flex-start;
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--ink-3, var(--boxel-400));
      }
      /* a hover-revealed control must also appear on focus-within */
      .pretui-instr-remove {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        flex: none;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: none;
        color: var(--ink-3, var(--boxel-400));
        cursor: pointer;
        opacity: 0;
        transition: opacity 140ms linear;
      }
      .pretui-instr-row:hover .pretui-instr-remove,
      .pretui-instr-row:focus-within .pretui-instr-remove {
        opacity: 1;
      }
      .pretui-instr-remove:hover {
        background: var(--hover, var(--boxel-100));
        color: var(--pretui-destructive-ink, var(--boxel-danger));
      }
      .pretui-instr-remove:focus-visible {
        opacity: 1;
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }
      .pretui-instr-remove svg {
        width: 13px;
        height: 13px;
      }
      .pretui-instr-add {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }
      .pretui-instr-field {
        flex: 1;
        min-width: 0;
      }
      .pretui-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      /* touch never has hover, so the control is simply always there */
      @media (any-pointer: coarse) {
        .pretui-instr-remove {
          opacity: 1;
          width: 44px;
          height: 44px;
        }
      }
      /* unnamed container query — resolves against .pretui-instr */
      @container (max-width: 24rem) {
        .pretui-instr-add {
          flex-wrap: wrap;
        }
        .pretui-instr-field {
          flex-basis: 100%;
        }
      }
    </style>
  </template>
}
