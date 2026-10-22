// Pretui — TranscriptStatus: one honest line on what the assistant is doing now.
import Component from '@glimmer/component';

export interface TranscriptStatusSignature {
  Args: {
    /** calls or runs still working */
    working?: number;
    /** decisions waiting on the reader */
    waiting?: number;
    /** runs working in the background, outside this turn */
    background?: number;
  };
  Element: HTMLParagraphElement;
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "Waiting for you · nothing else running", "2 runs working · 1 waits for
 * you": the activity rail under the transcript. It says what waits and
 * what runs together, so "waiting" never hides work still going, and
 * "running" never hides a question.
 */
export class TranscriptStatus extends Component<TranscriptStatusSignature> {
  get tone(): 'attention' | 'running' | 'idle' {
    if (this.args.waiting) {
      return 'attention';
    }
    return this.args.working || this.args.background ? 'running' : 'idle';
  }
  get parts(): string[] {
    let { working = 0, waiting = 0, background = 0 } = this.args;
    let parts: string[] = [];
    if (waiting) {
      parts.push(
        working || background
          ? `${waiting} ${waiting === 1 ? 'waits' : 'wait'} for you`
          : 'Waiting for you',
      );
    }
    if (working) {
      parts.push(count(working, 'call working', 'calls working'));
    }
    if (background) {
      parts.push(count(background, 'run in the background', 'runs in the background'));
    }
    if (waiting && !working && !background) {
      parts.push('nothing else running');
    }
    return parts.length ? parts : ['Nothing running'];
  }
  <template>
    <p
      class='pretui-tstatus'
      role='status'
      data-tone={{this.tone}}
      data-test-pretui-transcript-status
      ...attributes
    >
      <span class='pretui-tstatus-dot' aria-hidden='true'></span>
      {{#each this.parts as |part index|}}{{#if index}}<span
            aria-hidden='true'
          > · </span>{{/if}}<span>{{part}}</span>{{/each}}
    </p>
    <style scoped>
      @layer PretComponent {
        .pretui-tstatus {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 0 2px;
          margin: 0;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          font-variant-numeric: tabular-nums;
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
        }
        .pretui-tstatus-dot {
          width: 6px;
          height: 6px;
          margin-inline-end: var(--step-8, 8px);
          border-radius: 50%;
          background: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
        }
        /* a state colours the mark; the words step up to ink-2, never to
           the state colour as a whole line */
        .pretui-tstatus[data-tone='attention'] .pretui-tstatus-dot {
          background: var(
            --state-attention,
            var(--pretui-attention, var(--boxel-fuschia))
          );
        }
        .pretui-tstatus[data-tone='running'] .pretui-tstatus-dot {
          background: var(--state-live, var(--boxel-highlight));
        }
        .pretui-tstatus[data-tone='attention'] {
          color: var(--ink-2, var(--muted-foreground));
        }
      }
    </style>
  </template>
}
