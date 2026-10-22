// Pretui — Composer usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Composer } from './composer';
import type { ComposerAttachment } from './composer';

// ── Composer ─────────────────────────────────────────────────────────────
const ATTACHMENTS: ComposerAttachment[] = [
  { id: 'a1', label: 'Slow Bloom Coffee · Menu', auto: true },
  { id: 'a2', label: 'Kandy lot 118 · contract.pdf' },
];

class ComposerUsage extends GlimmerComponent {
  @tracked mode = 'ask';
  @tracked queueCount = 0;
  @tracked busy = false;
  @tracked attachments: ComposerAttachment[] = ATTACHMENTS;
  @tracked sent = '—';

  setMode = (mode: string) => (this.mode = mode);
  setQueue = (n: number) => (this.queueCount = n);
  bumpQueue = () => (this.queueCount = this.queueCount === 0 ? 2 : 0);
  toggleBusy = (busy: boolean) => (this.busy = busy);
  flipBusy = () => (this.busy = !this.busy);

  send = (text: string, mode: string) => {
    this.sent = mode.toUpperCase() + ' · ' + text;
  };
  stop = () => {
    this.busy = false;
    this.sent = 'run stopped';
  };
  pin = (attachment: ComposerAttachment) => {
    this.attachments = this.attachments.map((a) =>
      a.id === attachment.id ? { ...a, auto: false } : a,
    );
  };
  remove = (attachment: ComposerAttachment) => {
    this.attachments = this.attachments.filter((a) => a.id !== attachment.id);
  };
  reset = () => (this.attachments = ATTACHMENTS);

  <template>
    <FreestyleUsage
      @name='Composer'
      @description='The prompt bar, carrying the four things a bare textarea cannot: the context the agent will actually see, the mode that decides whether it may write, a note stating that mode’s consequence, and a hint that tells the truth while a run is in flight. The field grows with its content through a CSS grid replica — no measurement, no resize observer, no timer. Enter sends and Shift+Enter inserts a newline (Mod+Enter always sends, whichever way you set @submitOnEnter). The hint is deliberately NOT a `placeholder` attribute: a placeholder doubles as the accessible name, so the field would lose its name the moment you typed, and this hint changes with the mode and the queue — the worst possible candidate for a name. `aria-label` names the field permanently and the hint is aria-hidden beside it.'
    >
      <:example>
        <Composer
          @mode={{this.mode}}
          @onModeChange={{this.setMode}}
          @attachments={{this.attachments}}
          @onPin={{this.pin}}
          @onRemove={{this.remove}}
          @queueCount={{this.queueCount}}
          @busy={{this.busy}}
          @onSend={{this.send}}
          @onStop={{this.stop}}
        >
          <:tools>
            <Button @tone='neutral' @appearance='plain' @size='s'>Settings</Button>
          </:tools>
        </Composer>
        <p class='demo-log'>last:
          <strong>{{this.sent}}</strong></p>
        <p class='demo-hint'>Try it: type two lines with Shift+Enter and watch
          the field grow, switch Ask→Act and read the note, then queue two
          messages and see the hint change.</p>
        <span class='demo-row'>
          <Button
            @tone='neutral'
            @appearance='outlined'
            @size='s'
            {{on 'click' this.bumpQueue}}
          >Toggle queue</Button>
          <Button
            @tone='neutral'
            @appearance='outlined'
            @size='s'
            {{on 'click' this.flipBusy}}
          >Toggle run</Button>
          <Button
            @tone='neutral'
            @appearance='outlined'
            @size='s'
            {{on 'click' this.reset}}
          >Reset attachments</Button>
        </span>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='mode'
          @description='Which mode is active. Uncontrolled by default (@defaultMode picks the starting one); pass @mode + @onModeChange to own it.'
          @value={{this.mode}}
          @onInput={{this.setMode}}
          @defaultValue='ask'
        />
        <Args.Number
          @name='queueCount'
          @description='How many messages are already queued. Non-zero rewrites the hint to say so — a queue the reader cannot see is a message they think was sent.'
          @value={{this.queueCount}}
          @onInput={{this.setQueue}}
          @defaultValue={{0}}
          @min={{0}}
          @max={{5}}
        />
        <Args.Bool
          @name='busy'
          @description='A run is in flight: Send becomes Stop and fires @onStop instead.'
          @value={{this.busy}}
          @onInput={{this.toggleBusy}}
          @defaultValue={{false}}
        />
        <Args.Object
          @name='attachments'
          @description='The context chips. { id, label, auto? } — `auto` is context the host attached on the reader’s behalf (the "Viewing" tag), and only those fire @onPin, because pinning is the promotion from incidental to deliberate.'
          @value={{this.attachments}}
        />
        <Args.Object
          @name='modes'
          @description='The mode segments: { value, label, note?, placeholder? }. Defaults to COMPOSER_MODES — Ask ("reads only") and Act ("may propose changes"). The note is rendered in a role=status, so switching mode announces the consequence rather than leaving it as decoration.'
          @value={{this.attachments}}
          @hideControls={{true}}
        />
        <Args.Yield
          @name='tools'
          @description='Extra controls in the action bar, left of Send. The extraction spec’s settings popover (autonomy levels + three toggles) lives HERE rather than being baked in: autonomy is a host policy, and a kit component that hard-codes three specific toggles is wrong for every host but one.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='value / defaultValue / onInput / onSend / onStop'
          @description='The draft channel. Omit @value and the composer holds its own; pass it and you own it. @onSend receives the trimmed draft and the active mode.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='rows / submitOnEnter / label / disabled / sendLabel / stopLabel'
          @description='Minimum visible rows before the field grows (default 2, capped at 12), whether a plain Enter submits (default true), the field’s permanent accessible name, and the two button faces. Not built: collapse/expand — the auto-growing field is the behaviour collapse was approximating.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .demo-log {
        margin: var(--space-4, 11px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .demo-log strong {
        color: var(--foreground);
        font-weight: 600;
      }
      .demo-hint {
        margin: var(--space-3, 7px) 0 var(--space-4, 11px);
        max-width: 62ch;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
      .demo-row {
        display: inline-flex;
        gap: 8px;
        flex-wrap: wrap;
      }
    </style>
  </template>
}

export const DEMOS_COMPOSER: Record<string, unknown> = {
  Composer: ComposerUsage,
};
