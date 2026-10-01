// Pretui — WorkItem: one unit of agent work at three densities (step, action, run), with status text for every state.
import Component from '@glimmer/component';
import { ProgressBar } from './progress-bar';
import { Spinner } from './spinner';

type Tone = 'idle' | 'running' | 'attention' | 'done' | 'failed';
const TONES: Record<string, Tone> = {
  pending: 'idle', preparing: 'running', running: 'running', applying: 'running',
  handoff: 'running', reconnecting: 'running', 'host-attached': 'running',
  fallback: 'running', ready: 'attention', 'awaiting-approval': 'attention',
  ask: 'attention', input: 'attention', completed: 'done', kept: 'done',
  delivered: 'done', failed: 'failed', invalid: 'failed', reverted: 'idle',
  canceled: 'idle',
};
const GLYPHS: Record<Tone, string> = { idle: '·', running: '', attention: '●', done: '✓', failed: '✕' };
const DEFAULT_STATUS: Record<string, string> = {
  pending: 'queued', preparing: 'preparing…', running: 'running…',
  applying: 'applying…', handoff: 'handing off…', reconnecting: 'reconnecting…',
  'host-attached': 'attached', fallback: 'fallback…', ready: '● needs you',
  'awaiting-approval': '● needs you', ask: '● needs you', input: '● needs you',
  completed: 'done', kept: 'kept', delivered: 'delivered', failed: 'failed',
  invalid: 'invalid', reverted: 'reverted', canceled: 'canceled',
};

export interface WorkItemSignature {
  Args: {
    tier?: 'step' | 'action' | 'run';
    state?: string;
    verb?: string;
    title: string;
    status?: string;
    progressValue?: number;
    progressMax?: number;
    count?: string;
    activity?: string;
  };
  Blocks: { default: []; footer: [] };
  Element: HTMLDivElement;
}

export class WorkItem extends Component<WorkItemSignature> {
  get state() {
    return this.args.state ?? 'pending';
  }
  get tone(): Tone {
    return TONES[this.state] ?? 'idle';
  }
  get glyph() {
    return GLYPHS[this.tone];
  }
  get isRunning() {
    return this.tone === 'running';
  }
  get isAttention() {
    return this.tone === 'attention';
  }
  get statusText() {
    return this.args.status ?? DEFAULT_STATUS[this.state] ?? this.state;
  }
  get hasProgress() {
    return this.args.progressValue !== undefined;
  }
  get progressValue() {
    return this.args.progressValue ?? 0;
  }
  get countText() {
    if (this.args.count) {
      return this.args.count;
    }
    return `${this.args.progressValue} / ${this.args.progressMax}`;
  }
  get hasBody() {
    return this.hasProgress || this.args.activity;
  }
  <template>
    <div
      class='pretui-workitem'
      data-tier={{if @tier @tier 'step'}}
      data-state={{this.state}}
      data-attention={{if this.isAttention 'true'}}
      data-test-pretui-work-item
      ...attributes
    >
      <div class='pretui-workitem-row'>
        <span class='pretui-disc' data-tone={{this.tone}}>
          {{#if this.isRunning}}<Spinner @size={{9}} />{{else}}{{this.glyph}}{{/if}}
        </span>
        {{#if @verb}}<span class='pretui-verb'>{{@verb}}</span>{{/if}}
        <span class='pretui-workitem-title'>{{@title}}</span>
        <span class='pretui-workitem-status' data-tone={{this.tone}}>{{this.statusText}}</span>
      </div>
      {{#if this.hasBody}}
        <div class='pretui-workitem-body'>
          {{#if this.hasProgress}}
            <ProgressBar @value={{this.progressValue}} @max={{@progressMax}} @count={{this.countText}} />
          {{/if}}
          {{#if @activity}}<div class='pretui-activity'>{{@activity}}</div>{{/if}}
          {{yield}}
        </div>
      {{else}}
        {{yield}}
      {{/if}}
      {{yield to='footer'}}
    </div>
    <style scoped>
      .pretui-workitem {
        display: flex;
        flex-direction: column;
        background: var(--card);
        border-radius: 10px;
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        font-size: var(--text-ui-md, 12.5px);
      }
      .pretui-workitem[data-attention] {
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--pretui-attention, var(--boxel-fuschia)) 60%, var(--border)),
          0 2px 10px color-mix(in oklch, var(--pretui-attention, var(--boxel-fuschia)) 14%, transparent);
        background: linear-gradient(
          180deg,
          color-mix(in oklch, var(--pretui-attention, var(--boxel-fuschia)) 7%, var(--card)),
          var(--card) 55%
        );
      }
      .pretui-workitem[data-state='failed'],
      .pretui-workitem[data-state='invalid'] {
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--destructive) 45%, var(--border));
      }
      .pretui-workitem-row {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 7px 11px;
        min-height: 32px;
      }
      .pretui-workitem-body {
        padding: 0 11px 9px 36px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .pretui-disc {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        flex: none;
        font-size: 9px;
        font-weight: 700;
        background: var(--inset, var(--boxel-100));
        color: var(--muted-foreground);
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
      }
      .pretui-disc[data-tone='failed'] {
        background: color-mix(in oklch, var(--destructive) 15%, var(--card));
        color: var(--pretui-destructive-ink, var(--boxel-danger));
      }
      .pretui-disc[data-tone='attention'] {
        background: color-mix(in oklch, var(--pretui-attention, var(--boxel-fuschia)) 22%, var(--card));
        color: var(--pretui-attention-ink, var(--pretui-attention, var(--boxel-fuschia)));
      }
      .pretui-verb {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        color: var(--muted-foreground);
        flex: none;
      }
      .pretui-workitem-title {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
        flex: 1;
      }
      .pretui-workitem-status {
        margin-left: auto;
        flex: none;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
        display: flex;
        align-items: center;
        gap: 6px;
        font-variant-numeric: tabular-nums;
      }
      .pretui-workitem-status[data-tone='attention'] {
        color: var(--pretui-attention-ink, var(--pretui-attention, var(--boxel-fuschia)));
        font-weight: 600;
      }
      .pretui-workitem-status[data-tone='failed'] {
        color: var(--pretui-destructive-ink, var(--boxel-danger));
        font-weight: 500;
      }
      .pretui-activity {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--ink-3, var(--boxel-400));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </template>
}
