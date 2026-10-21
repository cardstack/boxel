// Pretui — GateStack: several decisions waiting at once, one open at a time.
import Component from '@glimmer/component';
import ChevronLeftIcon from '@cardstack/boxel-icons/chevron-left';
import ChevronRightIcon from '@cardstack/boxel-icons/chevron-right';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

export interface StackedGate {
  id: string;
  /** what the decision is about, as its row titles it */
  title: string;
  /** a word on its kind: 'delete', 'download', 'question' */
  kind?: string;
}

export interface GateStackSignature {
  Args: {
    gates: StackedGate[];
    /** the open gate's index, controlled; omit to let the stack hold it */
    current?: number;
    onCurrentChange?: (index: number) => void;
  };
  Blocks: {
    /** the open gate itself: a ToolGate, an AgentQuestion */
    default: [gate: StackedGate, index: number];
  };
  Element: HTMLDivElement;
}

/**
 * When three calls wait at once, asking all three at full size is a wall.
 * The stack opens the first, says "1 of 3", and folds the rest to a line
 * each ("Next: Delete pick.md"), so the reader answers in order or jumps.
 * Settling a gate (the caller drops it from @gates) opens the next.
 */
export class GateStack extends Component<GateStackSignature> {
  @tracked private inner = 0;
  get current(): number {
    let n = this.args.gates.length;
    let i = this.args.current ?? this.inner;
    return n ? Math.min(Math.max(i, 0), n - 1) : 0;
  }
  get gate(): StackedGate | undefined {
    return this.args.gates[this.current];
  }
  get position(): string {
    return `${this.current + 1} of ${this.args.gates.length}`;
  }
  get rest(): { gate: StackedGate; index: number }[] {
    return this.args.gates
      .map((gate, index) => ({ gate, index }))
      .filter(({ index }) => index !== this.current);
  }
  get atStart() {
    return this.current === 0;
  }
  get atEnd() {
    return this.current >= this.args.gates.length - 1;
  }
  go = (index: number) => {
    this.inner = index;
    this.args.onCurrentChange?.(index);
  };
  prev = () => this.go(this.current - 1);
  next = () => this.go(this.current + 1);
  <template>
    <div
      class='pretui-gatestack'
      role='group'
      aria-label='Decisions waiting'
      data-test-pretui-gate-stack
      ...attributes
    >
      {{#if this.gate}}
        <div class='pretui-gatestack-head'>
          <span class='pretui-gatestack-dot' aria-hidden='true'></span>
          <span
            class='pretui-gatestack-pos'
            aria-live='polite'
            data-test-pretui-gate-stack-position
          >{{this.position}} waiting</span>
          {{#if this.rest.length}}
            <span class='pretui-gatestack-pager'>
              <button
                type='button'
                class='pretui-gatestack-step'
                aria-label='Previous decision'
                disabled={{this.atStart}}
                data-test-pretui-gate-stack-prev
                {{on 'click' this.prev}}
              ><ChevronLeftIcon width='14' height='14' /></button>
              <button
                type='button'
                class='pretui-gatestack-step'
                aria-label='Next decision'
                disabled={{this.atEnd}}
                data-test-pretui-gate-stack-next
                {{on 'click' this.next}}
              ><ChevronRightIcon width='14' height='14' /></button>
            </span>
          {{/if}}
        </div>
        <div class='pretui-gatestack-open' data-test-pretui-gate-stack-open={{this.gate.id}}>
          {{yield this.gate this.current}}
        </div>
        {{#each this.rest as |item|}}
          <button
            type='button'
            class='pretui-gatestack-next'
            data-test-pretui-gate-stack-item={{item.gate.id}}
            {{on 'click' (fn this.go item.index)}}
          >
            <span class='pretui-gatestack-next-label'>{{if
                (this.isBefore item.index)
                'Earlier'
                'Next'
              }}</span>
            {{item.gate.title}}
            {{#if item.gate.kind}}<span
                class='pretui-gatestack-kind'
              >{{item.gate.kind}}</span>{{/if}}
          </button>
        {{/each}}
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        /* needs you: the edge and the dot take the attention state; the
           fill stays the card */
        .pretui-gatestack {
          display: grid;
          gap: var(--step-4, 4px);
          padding: var(--step-8, 8px);
          border-radius: var(--round-surface, 12px);
          box-shadow: inset 0 0 0 1px
            var(--state-attention, var(--pretui-attention));
          background: var(--card);
        }
        .pretui-gatestack-head {
          display: flex;
          align-items: center;
          gap: var(--step-8, 8px);
          padding-inline: 2px;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          font-weight: 600;
          color: var(--foreground);
        }
        .pretui-gatestack-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--state-attention, var(--pretui-attention));
        }
        .pretui-gatestack-pos {
          font-variant-numeric: tabular-nums;
        }
        .pretui-gatestack-pager {
          display: flex;
          gap: 2px;
          margin-inline-start: auto;
        }
        .pretui-gatestack-step {
          display: inline-grid;
          place-items: center;
          width: 24px;
          height: 24px;
          padding: 0;
          border: 0;
          border-radius: var(--round-chip, 4px);
          background: none;
          font: inherit;
          color: var(--ink-2, var(--muted-foreground));
          cursor: pointer;
        }
        .pretui-gatestack-step:hover:not(:disabled) {
          background: var(--hover, var(--inset));
          color: var(--foreground);
        }
        .pretui-gatestack-step:disabled {
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
          opacity: 0.5;
          cursor: default;
        }
        .pretui-gatestack-open {
          display: grid;
          gap: var(--step-8, 8px);
          padding: var(--step-4, 4px) 2px var(--step-8, 8px);
        }
        .pretui-gatestack-next {
          display: flex;
          align-items: baseline;
          gap: var(--step-8, 8px);
          min-height: 32px;
          padding: 0 var(--step-8, 8px);
          border: 0;
          border-radius: var(--round-row, 8px);
          background: none;
          box-shadow: 0 -1px 0 var(--border);
          font: inherit;
          font-size: var(--type-ui, 12.5px);
          line-height: 32px;
          text-align: start;
          color: var(--pretui-toolrow-settled-ink, var(--ink-2, var(--foreground)));
          cursor: pointer;
        }
        .pretui-gatestack-next:hover {
          background: var(--hover, var(--inset));
        }
        .pretui-gatestack-next:focus-visible,
        .pretui-gatestack-step:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-gatestack-next-label,
        .pretui-gatestack-kind {
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
        }
        .pretui-gatestack-kind {
          margin-inline-start: auto;
        }
      }
    </style>
  </template>

  isBefore = (index: number) => index < this.current;
}
