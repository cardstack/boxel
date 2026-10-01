// Pretui — DynamicIsland usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { DynamicIsland } from './dynamic-island';
import type { IslandView } from './dynamic-island';

// ── DynamicIsland ────────────────────────────────────────────────────────
export class DynamicIslandUsage extends Component {
  @tracked view: IslandView = 'compact';
  @tracked expandable = true;

  viewOptions = ['idle', 'compact', 'expanded'];

  setView = (v: string) => {
    this.view = v as IslandView;
  };
  setExpandable = (v: boolean) => {
    this.expandable = v;
  };
  onViewChange = (v: IslandView) => {
    this.view = v;
  };

  get usage(): string {
    return [
      '<DynamicIsland',
      "  @label='Indexing status'",
      "  @view='" + this.view + "'",
      '  @onViewChange={{this.onViewChange}}',
      '>',
      '  <:idle>…</:idle>',
      '  <:compact>…</:compact>',
      '  <:expanded>…</:expanded>',
      '</DynamicIsland>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='DynamicIsland'
      @description='A status capsule that morphs between three views. The growth is the point and it is legitimate under Law 5: it tells the reader the SAME object gained detail rather than a second surface appearing. The view is DATA — set by the host or toggled by the reader — never advanced by a clock, which is both the realm law and the reason this reads as status rather than as an animation.'
      @source={{this.usage}}
    >
      <:example>
        <div class='island-stage'>
          <DynamicIsland
            @label='Indexing status'
            @view={{this.view}}
            @onViewChange={{this.onViewChange}}
            @expandable={{this.expandable}}
          >
            <:idle>
              <span class='island-dot'></span>
            </:idle>
            <:compact>
              <span class='island-line'>
                <span class='island-dot'></span>
                <span>Indexing 42 cards</span>
              </span>
            </:compact>
            <:expanded>
              <div class='island-detail'>
                <p class='island-title'>Indexing 42 cards</p>
                <p class='island-sub'>Three realms, one write lock. The desk
                  keeps serving reads while this runs.</p>
                <div class='island-bar'><span class='island-fill'></span></div>
              </div>
            </:expanded>
          </DynamicIsland>
          <p class='island-note'>Click the capsule to expand it, or drive
            <code>@view</code>
            from the control panel.</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='view'
          @description='Controlled view: idle, compact or expanded. Omit for uncontrolled.'
          @options={{this.viewOptions}}
          @value={{this.view}}
          @onInput={{this.setView}}
          @defaultValue='compact'
        />
        <Args.Action
          @name='onViewChange'
          @description='Fires with the next view on every change.'
        />
        <Args.Bool
          @name='expandable'
          @description='Let the reader toggle compact ⇄ expanded. Turn it off for a purely host-driven status capsule — the morph still happens when @view changes.'
          @defaultValue={{true}}
          @value={{this.expandable}}
          @onInput={{this.setExpandable}}
        />
        <Args.String
          @name='label'
          @description='Accessible name for the capsule. The capsule carries role=status, so a change is announced politely without stealing focus.'
        />
        <Args.Yield
          @name='idle'
          @description='The resting sliver — a dot, a bar, a single glyph.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='compact'
          @description='The one-line state: what is happening, right now.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='expanded'
          @description='The detail: controls, progress, a description.'
          @hideControls={{true}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-island-ground'
          @type='color'
          @description='Capsule fill.'
          @defaultValue='var(--foreground)'
        />
        <Css.Basic
          @name='pretui-island-expanded-height'
          @type='dimension'
          @description='Height of the expanded view. The geometry is a token set, not hard-coded pixels — which is what makes the morph both animatable and re-cuttable by a season.'
          @defaultValue='156px'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .island-stage {
        display: grid;
        gap: var(--space-4, 11px);
        justify-items: center;
        padding: var(--space-6, 19px);
        border-radius: var(--radius-surface, 10px);
        background: var(--muted);
      }
      .island-dot {
        inline-size: 8px;
        block-size: 8px;
        border-radius: 999px;
        background: var(--chart-1);
        flex: 0 0 auto;
      }
      .island-line {
        display: inline-flex;
        align-items: center;
        gap: var(--space-3, 8px);
      }
      .island-detail {
        display: grid;
        gap: 5px;
        padding-block-start: 2px;
      }
      .island-title {
        margin: 0;
        font-weight: var(--weight-strong, 600);
      }
      .island-sub {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        opacity: 0.72;
      }
      .island-bar {
        margin-block-start: 4px;
        block-size: 5px;
        border-radius: 999px;
        background: color-mix(in oklch, currentColor 22%, transparent);
        overflow: hidden;
      }
      .island-fill {
        display: block;
        block-size: 100%;
        inline-size: 62%;
        border-radius: 999px;
        background: var(--chart-1);
      }
      .island-note {
        margin: 0;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .island-note code {
        font-family: var(--font-mono);
      }
    </style>
  </template>
}

export const DEMOS_DYNAMIC_ISLAND: Record<string, unknown> = {
  DynamicIsland: DynamicIslandUsage,
};
