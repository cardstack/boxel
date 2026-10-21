// Pretui — ToolGate: the decision a tool call waits on, asked inside its row.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { StateGlyph } from './state-glyph';

export interface ToolGateAction {
  /** the button's words: 'Allow once', 'Keep 40', 'Revert' */
  label: string;
  /** 'primary' (the one filled button), 'secondary' (outlined), or 'quiet'
   * (text). Default 'secondary' */
  kind?: 'primary' | 'secondary' | 'quiet';
  /** a stable name for the answer ('apply', 'always', 'deny'): what a host
   * finds it by, and its test hook. Default: the label */
  id?: string;
  /** the action; a returned promise keeps the gate busy until it settles */
  onAct: () => unknown;
  /** what the button reads while its action runs. Default: label and "…" */
  busyLabel?: string;
  /** an "always" answer: what it grants is said under it before it is
   * given ("Allows realm.fs.delete in showcase/scratch/ for this session"),
   * and a destructive gate never offers one */
  always?: boolean;
  /** the decline: the gate asks why (optional) and hands the reason to
   * `onDecline` instead of running `onAct` */
  declines?: boolean;
}

export interface ToolGateSignature {
  Args: {
    /** the question, in one sentence: "This waits for your click." */
    prompt: string;
    /** why it asks, or what the click allows; a quieter second line */
    detail?: string;
    /** the answers, most likely first. Omit when the decision is someone
     * else's (@waitingOn) */
    actions?: ToolGateAction[];
    /** the decision belongs to this person: the gate says so and offers
     * no buttons. "Rupert" → "Waiting on Rupert" */
    waitingOn?: string;
    /** 'attention' (default) for a question, 'conflict' when the call found
     * that something moved since it asked */
    tone?: 'attention' | 'conflict';
    /** the call cannot be undone: the gate says so in words, and drops any
     * "always" answer, since a standing yes to a delete is not a yes the
     * reader can see the cost of */
    destructive?: boolean;
    /** what an "always" answer grants, said under the answers while it is
     * focused or hovered: "realm.fs.delete in showcase/scratch/" */
    scope?: string;
    /** the decline's reason, optional: asked when an answer marked
     * `declines` is pressed, then handed here */
    onDecline?: (reason: string) => unknown;
    /** the call was allowed by a standing answer: the gate is a receipt,
     * "Allowed for this session", with no buttons */
    auto?: string;
    /** the question ended without an answer: 'canceled' (the run went on
     * without it) or 'expired' (nobody answered in time). The gate says so,
     * with no buttons */
    resolution?: 'canceled' | 'expired';
    /** the reader cannot answer here (a read-only transcript, a teammate's
     * request): the question shows, its answers do not */
    readonly?: boolean;
  };
  /** what the reader decides about: a picker, the files a preview staged */
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

/**
 * The in-row gate. One question, its answers, and one busy state for all
 * of them, so a decision is made once:
 *
 * ```hbs
 * <ToolRow @name='run-realm-code' @state='ready' @framed={{true}}>
 *   <:gate>
 *     <ToolGate @prompt='This waits for your click.'
 *       @actions={{array (hash label='Allow once' kind='primary' onAct=this.allow)
 *                        (hash label='Always for this session' onAct=this.always)
 *                        (hash label='Deny' kind='quiet' onAct=this.deny)}} />
 *   </:gate>
 * </ToolRow>
 * ```
 */
export class ToolGate extends Component<ToolGateSignature> {
  /** the label of the action in flight; every answer waits on it */
  @tracked busy: string | undefined;
  @tracked declining = false;
  @tracked reason = '';
  readonly promptId = guidFor(this) + '-prompt';

  get actions(): ToolGateAction[] {
    if (this.args.waitingOn || this.args.auto || this.args.resolution || this.args.readonly) {
      return [];
    }
    let actions = this.args.actions ?? [];
    return this.args.destructive ? actions.filter((a) => !a.always) : actions;
  }
  get hasAlways(): boolean {
    return Boolean(this.args.scope) && this.actions.some((a) => a.always);
  }
  get prompt(): string {
    if (this.args.resolution) {
      let how = this.args.resolution === 'expired' ? 'Expired' : 'Canceled';
      return `${how} · ${this.args.prompt}`;
    }
    return this.args.waitingOn
      ? `Waiting on ${this.args.waitingOn}`
      : this.args.prompt;
  }
  labelOf = (action: ToolGateAction): string =>
    this.busy === action.label
      ? (action.busyLabel ?? `${action.label}…`)
      : action.label;
  kindOf = (action: ToolGateAction): string => action.kind ?? 'secondary';
  isBusy = (action: ToolGateAction): boolean => this.busy === action.label;

  act = async (action: ToolGateAction) => {
    if (this.busy) {
      return;
    }
    if (action.declines && this.args.onDecline) {
      this.declining = true;
      return;
    }
    this.busy = action.label;
    try {
      await action.onAct();
    } finally {
      if (!this.isDestroying && !this.isDestroyed) {
        this.busy = undefined;
      }
    }
  };

  typeReason = (event: Event) =>
    (this.reason = (event.target as HTMLInputElement).value);
  cancelDecline = () => {
    this.declining = false;
    this.reason = '';
  };
  confirmDecline = async () => {
    if (this.busy) {
      return;
    }
    this.busy = 'decline';
    try {
      await this.args.onDecline?.(this.reason.trim());
    } finally {
      if (!this.isDestroying && !this.isDestroyed) {
        this.busy = undefined;
        this.declining = false;
      }
    }
  };
  reasonKey = (e: Event) => {
    let event = e as KeyboardEvent;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.confirmDecline();
    } else if (event.key === 'Escape') {
      this.cancelDecline();
    }
  };

  <template>
    <div
      class='pretui-toolgate'
      role='group'
      aria-labelledby={{this.promptId}}
      aria-busy={{if this.busy 'true'}}
      data-tone={{if @tone @tone 'attention'}}
      data-routed={{if @waitingOn 'true'}}
      data-destructive={{if @destructive 'true'}}
      data-auto={{if @auto 'true'}}
      data-resolution={{@resolution}}
      data-test-pretui-tool-gate
      ...attributes
    >
      <p class='pretui-toolgate-prompt' id={{this.promptId}}>
        {{#if @auto}}<span class='pretui-toolgate-auto' data-test-pretui-tool-gate-auto><StateGlyph
              class='pretui-toolgate-auto-mark'
              @glyph='done'
            />{{@auto}}</span>{{else}}{{this.prompt}}{{/if}}
        {{#if @destructive}}<span
            class='pretui-toolgate-destructive'
            data-test-pretui-tool-gate-destructive
          >This cannot be undone.</span>{{/if}}
        {{#if @detail}}<span
            class='pretui-toolgate-detail'
            data-test-pretui-tool-gate-detail
          >{{@detail}}</span>{{/if}}
      </p>
      {{yield}}
      {{#if this.declining}}
        <div class='pretui-toolgate-decline' data-test-pretui-tool-gate-decline>
          <input
            class='pretui-toolgate-reason'
            aria-label='Why not? (optional)'
            placeholder='Why not? (optional)'
            value={{this.reason}}
            {{on 'input' this.typeReason}}
            {{on 'keydown' this.reasonKey}}
          />
          <button
            type='button'
            class='pretui-toolgate-action'
            data-kind='primary'
            disabled={{if this.busy true}}
            data-test-pretui-tool-gate-decline-confirm
            {{on 'click' this.confirmDecline}}
          >Decline</button>
          <button
            type='button'
            class='pretui-toolgate-action'
            data-kind='quiet'
            {{on 'click' this.cancelDecline}}
          >Back</button>
        </div>
      {{else if this.actions.length}}
        <div class='pretui-toolgate-actions'>
          {{#each this.actions as |answer|}}
            <button
              type='button'
              class='pretui-toolgate-action'
              data-kind={{this.kindOf answer}}
              disabled={{if this.busy true}}
              aria-busy={{if (this.isBusy answer) 'true'}}
              aria-describedby={{this.promptId}}
              data-tool-gate-action={{answer.id}}
              data-test-pretui-tool-gate-action={{if
                answer.id
                answer.id
                answer.label
              }}
              {{on 'click' (fn this.act answer)}}
            >{{this.labelOf answer}}</button>
          {{/each}}
        </div>
        {{#if this.hasAlways}}
          <p class='pretui-toolgate-scope' data-test-pretui-tool-gate-scope>“Always” allows {{@scope}}</p>
        {{/if}}
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        /* the gate sits on the row's text edge, under its lines: a question
           and its answers, with no box of its own (the row is the box) */
        .pretui-toolgate {
          display: grid;
          gap: var(--step-8, 8px);
          padding-block: var(--step-4, 4px) 2px;
          padding-inline-start: calc(
            var(--pretui-toolrow-disc, 16px) +
              var(--pretui-toolrow-gap, var(--step-8, 8px))
          );
        }
        .pretui-toolgate-prompt {
          margin: 0;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          font-weight: 600;
          color: var(--foreground);
        }
        /* a conflict needs the reader: the prompt stays ink-1 and a dot
           before it takes the attention state (the mark, never the text) */
        .pretui-toolgate[data-tone='conflict'] .pretui-toolgate-prompt::before {
          content: '';
          display: inline-block;
          width: 6px;
          height: 6px;
          margin-inline-end: 6px;
          border-radius: 50%;
          vertical-align: 0.1em;
          background: var(
            --state-attention,
            var(--pretui-attention-ink, var(--pretui-attention))
          );
        }
        .pretui-toolgate[data-routed] .pretui-toolgate-prompt {
          font-weight: 400;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-toolgate[data-resolution] .pretui-toolgate-prompt {
          font-weight: 400;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-toolgate-destructive {
          display: block;
          font-weight: 600;
          color: var(--pretui-destructive-ink, var(--destructive));
        }
        .pretui-toolgate-auto {
          font-weight: 400;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-toolgate-auto-mark {
          display: inline-grid;
          margin-inline-end: var(--step-4, 4px);
          vertical-align: -1px;
        }
        .pretui-toolgate-scope {
          margin: 0;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
        }
        .pretui-toolgate-decline {
          display: flex;
          flex-wrap: wrap;
          gap: var(--step-8, 8px);
          align-items: center;
        }
        .pretui-toolgate-reason {
          flex: 1 1 160px;
          min-width: 0;
          height: 28px;
          padding: 0 var(--step-8, 8px);
          border: 0;
          border-radius: var(--round-row, 8px);
          background: var(--field, var(--inset));
          box-shadow: inset 0 0 0 1px var(--input, var(--border));
          font: inherit;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          color: var(--foreground);
        }
        .pretui-toolgate-reason::placeholder {
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
        }
        .pretui-toolgate-reason:focus {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-toolgate-detail {
          display: block;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-weight: 400;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-toolgate-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--step-8, 8px);
        }
        /* answers: the one answer is --primary; the rest are outlined
           (secondary) or quiet text */
        .pretui-toolgate-action {
          min-height: 28px;
          padding: 0 var(--step-12, 12px);
          border: 0;
          border-radius: var(--round-row, 8px);
          background: none;
          box-shadow: inset 0 0 0 1px var(--border-strong, var(--border));
          font: inherit;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          font-weight: 600;
          color: var(--foreground);
          cursor: pointer;
          white-space: nowrap;
        }
        .pretui-toolgate-action[data-kind='primary'] {
          box-shadow: none;
          background: var(--primary);
          color: var(--primary-foreground);
        }
        .pretui-toolgate-action[data-kind='quiet'] {
          box-shadow: none;
          font-weight: 400;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-toolgate-action:hover:not(:disabled) {
          background: var(--hover, var(--inset));
        }
        .pretui-toolgate-action[data-kind='quiet']:hover:not(:disabled) {
          background: none;
          color: var(--foreground);
        }
        .pretui-toolgate-action[data-kind='primary']:hover:not(:disabled) {
          background: color-mix(in srgb, var(--primary) 88%, var(--foreground));
        }
        .pretui-toolgate-action:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-toolgate-action:disabled {
          cursor: default;
          opacity: 0.6;
        }
        .pretui-toolgate-action[aria-busy='true'] {
          opacity: 1;
        }
      }
    </style>
  </template>
}
