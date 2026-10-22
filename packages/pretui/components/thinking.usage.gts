// Pretui — Thinking usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Thinking } from './thinking';
import type { ThinkingRow } from './thinking';

// ── Thinking ─────────────────────────────────────────────────────────────
const TRACE: ThinkingRow[] = [
  {
    id: 't1',
    primary: 'Read the Kandy auction catalogue',
    state: 'done',
    secondary: '18 lots',
  },
  {
    id: 't2',
    primary: 'Compared cupping scores against the 2025 mean',
    state: 'done',
    secondary: 'mean 82.4',
    mono: true,
  },
  {
    id: 't3',
    primary: 'Lot 118 is the only one above 88 that is still unsold, which is why it leads the recommendation rather than the cheaper lot 104.',
    wrap: true,
  },
  {
    id: 't4',
    primary: 'Rewrote the pricing rule',
    state: 'done',
    secondary: 'pricing.gts',
    mono: true,
    add: 24,
    del: 7,
  },
  { id: 't5', primary: 'Re-running the valuation', state: 'running' },
];

class ThinkingUsage extends GlimmerComponent {
  @tracked working = true;
  @tracked expanded = true;

  setWorking = (working: boolean) => (this.working = working);
  setExpanded = (expanded: boolean) => (this.expanded = expanded);
  flip = () => (this.working = !this.working);

  get rows(): ThinkingRow[] {
    if (this.working) {
      return TRACE;
    }
    return TRACE.map((row) =>
      row.state === 'running' ? { ...row, state: 'done' as const } : row,
    );
  }

  <template>
    <FreestyleUsage
      @name='Thinking'
      @description='The reasoning-trace rail. Closed it is one quiet line; open it is the ordered list of what the agent looked at, with diff counts on the rows that changed something. The shimmer on the label is the component’s only theatre and it is a deliberate one under Law 5: it encodes "this is still going" and it stops permanently the moment the settled label replaces it — a CSS background sweep, not a frame loop, landing on the plain label under prefers-reduced-motion. The elapsed time in @doneLabel is a caller string on purpose: computing it would need Date.now(), which a realm forbids, and the number belongs to the run rather than to the render. Collapsed, the panel is `inert`, so a keyboard user can never tab into rows they cannot see.'
    >
      <:example>
        <Thinking
          @working={{this.working}}
          @label='Thinking'
          @doneLabel='Thought for 6 seconds'
          @query='cupping score > 88 AND status = unsold'
          @rows={{this.rows}}
          @expanded={{this.expanded}}
          @onExpandedChange={{this.setExpanded}}
        />
        <p class='demo-hint'>Flip “working” and watch the shimmer settle into
          the elapsed label, and the last row’s spinner become a check.</p>
        <Button
          @tone='neutral'
          @appearance='outlined'
          @size='s'
          {{on 'click' this.flip}}
        >Toggle working</Button>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='rows'
          @description='The trace. { id, primary, state?: running|done, secondary?, mono?, add?, del?, wrap? }. `wrap` turns a row into prose reasoning — it wraps, drops to normal weight and quiets down — which is what separates a reasoning line from a tool line without a second component.'
          @value={{this.rows}}
        />
        <Args.Bool
          @name='working'
          @description='The trace is still being produced: the label shimmers and (by default) the rail starts open.'
          @value={{this.working}}
          @onInput={{this.setWorking}}
          @defaultValue={{false}}
        />
        <Args.Bool
          @name='expanded'
          @description='Controlled disclosure. Uncontrolled it defaults to @defaultExpanded, then to @working.'
          @value={{this.expanded}}
          @onInput={{this.setExpanded}}
        />
        <Args.String
          @name='query'
          @description='A search-trace query line pinned above the rows, for the common case where the whole trace was one lookup.'
          @value='cupping score > 88 AND status = unsold'
          @hideControls={{true}}
        />
        <Args.Base
          @name='label / doneLabel / onExpandedChange'
          @description='The shimmering label while working (default "Thinking"), the settled label (default "Done" — pass the elapsed time), and the disclosure callback.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='default'
          @description='Extra content appended inside the rail, below the rows — an embedded DiffBlock, a ResultCard, whatever the trace produced.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .demo-hint {
        margin: var(--space-4, 11px) 0 var(--space-3, 7px);
        max-width: 62ch;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_THINKING: Record<string, unknown> = {
  Thinking: ThinkingUsage,
};
