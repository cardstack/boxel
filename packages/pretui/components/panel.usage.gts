// Pretui — Panel usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { Panel } from '../structure';
import { Button } from '../controls';

// ── Panel ← container/usage.gts + card-container/usage.gts ───────────────

// Dropped knobs: tag (Panel renders a fixed <section>); display (body layout
// is left to content — no grid/flex switch); displayBoundaries (Panel always
// draws its card surface and hairline).
class PanelUsage extends GlimmerComponent {
  @tracked title = 'Card';
  @tracked eyebrow = 'container';
  setTitle = (v: string) => (this.title = v);
  setEyebrow = (v: string) => (this.eyebrow = v);
  <template>
    <FreestyleUsage
      @name='Panel'
      @description='A wrapper container for a card: the panel surface with standard padding, an optional title header, and the status/actions footer — the merged successor to Container and CardContainer.'
    >
      <:example>
        <Panel @title={{this.title}} @eyebrow={{this.eyebrow}} class='panel-box'>
          <:default>
            <p class='panel-copy'>Card content here — the body block is
              unstyled beyond standard padding, so one strategy is a root
              element with <code>display: grid</code> to lay out your card.</p>
          </:default>
          <:status>Saved just now</:status>
          <:actions>
            <Button @tone='neutral' @appearance='outlined' @size='s'>Export</Button>
            <Button @tone='primary' @size='s'>Publish</Button>
          </:actions>
        </Panel>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @description='Header title, shown at the top of the panel surface. Omit to render a headerless surface.'
          @value={{this.title}}
          @onInput={{this.setTitle}}
        />
        <Args.String
          @name='eyebrow'
          @description='Mono uppercase overline rendered above the title.'
          @value={{this.eyebrow}}
          @onInput={{this.setEyebrow}}
        />
        <Args.Yield
          @description='Unstyled area for custom card content and fields'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='status'
          @description='Status line at the start of the panel footer; the footer renders only when this block is present.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='actions'
          @description='Action buttons aligned to the end of the panel footer.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .panel-box {
        width: 100%;
        max-width: 420px;
      }
      .panel-copy {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_PANEL: Record<string, unknown> = {
  Panel: PanelUsage,
};
