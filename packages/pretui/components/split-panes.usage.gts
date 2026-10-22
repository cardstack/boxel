// Pretui — SplitPanes usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { SplitPanes } from './split-panes';

// ── SplitPanes ← resizable-panel-group/usage.gts ─────────────────────────
// Ported knobs: orientation (upstream showed it as two separate usages —
// here a live switch), reverseCollapse, and the per-panel
// defaultSize/minSize/maxSize/collapsible set (upstream repeats it for
// each of three panels; here panel 1 carries the live set, panels 2–3
// hold upstream defaults), plus panel 3's isHidden toggle. Dropped: the
// boxel-panel-resize-handle-* cssVars rows (handle colors are pinned to
// Pretui tokens by the wrapper).
class SplitPanesUsage extends Component {
  orientationOptions = ['horizontal', 'vertical'];
  @tracked orientation = 'horizontal';
  @tracked reverseCollapse = false;
  @tracked p1Default = 25;
  @tracked p1Min: number | undefined = undefined;
  @tracked p1Max: number | undefined = undefined;
  @tracked p1Collapsible = true;
  @tracked p3Hidden = false;
  setOrientation = (v: string) => (this.orientation = v);
  setReverseCollapse = (v: boolean) => (this.reverseCollapse = v);
  setP1Default = (v: number | null) => (this.p1Default = v ?? 25);
  setP1Min = (v: number | null) => (this.p1Min = v ?? undefined);
  setP1Max = (v: number | null) => (this.p1Max = v ?? undefined);
  setP1Collapsible = (v: boolean) => (this.p1Collapsible = v);
  setP3Hidden = (v: boolean) => (this.p3Hidden = v);
  get orientationVal() {
    return this.orientation as 'horizontal' | 'vertical';
  }
  get p2Default() {
    return this.p3Hidden ? 75 : 50;
  }
  get usage() {
    let bits = [`@orientation='${this.orientation}'`];
    if (this.reverseCollapse) bits.push('@reverseCollapse={{true}}');
    return `<SplitPanes ${bits.join(' ')} as |Panel Handle|>\n  <Panel @defaultSize={{${this.p1Default}}}>…</Panel>\n  <Handle />\n  <Panel @defaultSize={{${this.p2Default}}}>…</Panel>\n</SplitPanes>`;
  }
  <template>
    <FreestyleUsage
      @name='SplitPanes'
      @description="Split-pane layout with horizontal or vertical orientation and draggable dividers between panels — resizable IDE-style and master-detail layouts. Wraps boxel-ui's ResizablePanelGroup engine: percent-based constraint solving per panel, pointer-captured drag, double-click collapse on the outer handles. Hover a divider to reveal its handle."
      @source={{this.usage}}
    >
      <:example>
        <div class='split-host'>
          <SplitPanes
            @orientation={{this.orientationVal}}
            @reverseCollapse={{this.reverseCollapse}}
            as |Panel Handle|
          >
            <Panel
              @defaultSize={{this.p1Default}}
              @minSize={{this.p1Min}}
              @maxSize={{this.p1Max}}
              @collapsible={{this.p1Collapsible}}
            >
              <div class='split-fill'><span
                  class='split-label'
                >Pane 1</span></div>
            </Panel>
            <Handle />
            <Panel @defaultSize={{this.p2Default}}>
              <div class='split-fill'><span
                  class='split-label'
                >Pane 2</span></div>
            </Panel>
            {{#unless this.p3Hidden}}
              <Handle />
              <Panel @defaultSize={{25}}>
                <div class='split-fill'><span
                    class='split-label'
                  >Pane 3</span></div>
              </Panel>
            {{/unless}}
          </SplitPanes>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='orientation'
          @defaultValue='horizontal'
          @value={{this.orientation}}
          @options={{this.orientationOptions}}
          @description='Pane flow direction — upstream ships this as two separate usages; here it is one switch.'
          @onInput={{this.setOrientation}}
        />
        <Args.Bool
          @name='reverseCollapse'
          @defaultValue={{false}}
          @value={{this.reverseCollapse}}
          @description='Double-clicking a handle collapses outward by default; this reverses it — preferable in two-panel setups.'
          @onInput={{this.setReverseCollapse}}
        />
        <Args.Action
          @name='onLayoutChange'
          @description='Receives the full layout as number[] percentages after every resize.'
          @hideControls={{true}}
        />
        <Args.Number
          @name='Panel @defaultSize (pane 1)'
          @value={{this.p1Default}}
          @min={{0}}
          @max={{100}}
          @step={{5}}
          @description='Initial size as a 0–100 percentage. Applied when the panel registers.'
          @onInput={{this.setP1Default}}
        />
        <Args.Number
          @name='Panel @minSize (pane 1)'
          @value={{this.p1Min}}
          @description='Lower resize bound, percent. Double-click collapse ignores it while @collapsible is true.'
          @onInput={{this.setP1Min}}
        />
        <Args.Number
          @name='Panel @maxSize (pane 1)'
          @value={{this.p1Max}}
          @description='Upper resize bound, percent.'
          @onInput={{this.setP1Max}}
        />
        <Args.Bool
          @name='Panel @collapsible (pane 1)'
          @defaultValue={{true}}
          @value={{this.p1Collapsible}}
          @description='Allows the pane to collapse to zero; pair with @minSize when false.'
          @onInput={{this.setP1Collapsible}}
        />
        <Args.Bool
          @name='pane 3 hidden'
          @defaultValue={{false}}
          @value={{this.p3Hidden}}
          @description="Demo knob — removes the third pane and its handle to show the group relayouts as panels register and unregister (upstream's isHidden)."
          @onInput={{this.setP3Hidden}}
        />
        <Args.Yield
          @description='Yields the curried (Panel, Handle) pair — alternate Panels and Handles in the block.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .split-host {
        height: 220px;
        border-radius: var(--radius-surface, 10px);
        box-shadow: 0 0 0 1px var(--border);
        overflow: hidden;
      }
      .split-fill {
        height: 100%;
        display: grid;
        place-items: center;
        background: var(--inset, var(--boxel-100));
      }
      .split-label {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 500;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_SPLIT_PANES: Record<string, unknown> = {
  SplitPanes: SplitPanesUsage,
};
