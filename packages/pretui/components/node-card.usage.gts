// Pretui — NodeCard usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { statusHue } from '../internal/ink';
import { NodeCard } from './node-card';
import type { NodeCardData } from '../internal/surfaces-canvas';

// ── NodeCard ─────────────────────────────────────────────────────────────
// The default node body, shown here OUT of the canvas — it is a plain
// component and renders anywhere, which is the quickest way to read the
// cloth. React Flow's stock node is a 150px div with a hard-coded border
// and one label string; this page shows what replaced it. Dropped from
// upstream: nothing — the stock node had no surface to drop.
class NodeCardUsage extends Component {
  @tracked title = 'Da Hong Pao';
  @tracked kind = 'LOT-1181';
  @tracked meta = '96 kg · spring pick';
  @tracked status = 'curing';
  @tracked hue = '';
  @tracked selected = false;
  @tracked dragging = false;

  setTitle = (v: string) => (this.title = v);
  setKind = (v: string) => (this.kind = v);
  setMeta = (v: string) => (this.meta = v);
  setStatus = (v: string) => (this.status = v);
  setHue = (v: string) => (this.hue = v);
  setSelected = (v: boolean) => (this.selected = v);
  setDragging = (v: boolean) => (this.dragging = v);

  get data(): NodeCardData {
    return {
      title: this.title,
      kind: this.kind,
      meta: this.meta,
      status: this.status,
      ...(this.hue ? { hue: this.hue } : {}),
    };
  }

  get derivedHue() {
    return this.hue || statusHue(this.status);
  }

  get usage() {
    return `<NodeCard\n  @id='lot-dahongpao'\n  @data={{hash title='${this.title}' kind='${this.kind}' meta='${this.meta}' status='${this.status}'}}\n  @selected={{${this.selected}}}\n  @dragging={{${this.dragging}}}\n/>`;
  }

  <template>
    <FreestyleUsage
      @name='NodeCard'
      @description="The default body inside every NodeCanvas node, and a usable card anywhere else. Four parts, each optional: a mono Token for the machine value (Law 3), a title, one supporting line, and a status Chip whose hue is DERIVED from the status string by statusHue — so 'curing' is the same hue on every node every caller authors, without anyone picking a colour. Depth is a hairline plus a shadow, never a border for separation (Law 1); the hue shows as a rail on the inline-start edge, which is the part that survives a still frame (Law 8). Selection and drag are data-states set by the engine, shown live below. Handles are NOT drawn here — the canvas shell owns them, so a replacement body never has to think about connectors."
      @source={{this.usage}}
    >
      <:example>
        <div class='nodecard-stage'>
          <NodeCard
            @id='lot-dahongpao'
            @data={{this.data}}
            @selected={{this.selected}}
            @dragging={{this.dragging}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='data.title'
          @value={{this.title}}
          @onInput={{this.setTitle}}
          @description='The headline — the one line a reader scans for. Falls back to data.label, then to @id, then to “Untitled”.'
        />
        <Args.String
          @name='data.kind'
          @value={{this.kind}}
          @onInput={{this.setKind}}
          @description='Machine value (id, version, enum) rendered as an accent-tinted mono Token above the title. Omit it and the eyebrow disappears.'
        />
        <Args.String
          @name='data.meta'
          @value={{this.meta}}
          @onInput={{this.setMeta}}
          @description='One supporting line under the title, in the muted token.'
        />
        <Args.String
          @name='data.status'
          @value={{this.status}}
          @onInput={{this.setStatus}}
          @description='Short state word, rendered as a Chip. Its hue is a stable hash of this string — type anything and watch the whole treatment follow (Law 2).'
        />
        <Args.String
          @name='data.hue'
          @value={{this.hue}}
          @onInput={{this.setHue}}
          @description='Escape hatch: an explicit colour or var() that overrides the derived hue. Leave it empty and the hue is derived from the status; the Default column shows the hue currently in force.'
          @defaultValue={{this.derivedHue}}
        />
        <Args.Bool
          @name='selected'
          @value={{this.selected}}
          @defaultValue={{false}}
          @onInput={{this.setSelected}}
          @description='Set by the engine while the node is in the selection: primary ring plus a soft halo.'
        />
        <Args.Bool
          @name='dragging'
          @value={{this.dragging}}
          @defaultValue={{false}}
          @onInput={{this.setDragging}}
          @description='Set by the engine during a pointer drag: the card lifts to the overlay shadow.'
        />
        <Args.Object
          @name='data'
          @value={{this.data}}
          @description='NodeCardData — the whole payload. Extra keys are yours to read from a custom body.'
        />
        <Args.String
          @name='id'
          @hideControls={{true}}
          @description='Node id, passed by the engine. Used as the last-resort title.'
        />
        <Args.Object
          @name='node'
          @hideControls={{true}}
          @description='The whole CanvasNode record, passed by the engine — position, type, handle sides, flags.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-node-width'
          @defaultValue='200px'
          @description='Card width. The canvas measures the rendered node, so changing this re-routes the edges with it.'
        />
        <Css.Basic
          @name='pretui-node-radius'
          @description='Corner radius, defaulting to the --radius-surface token. Also used for the focus ring around a focused node.'
        />
        <Css.Basic
          @name='pretui-node-shadow'
          @description='Whole resting depth in one property — hairline and shadow together.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .nodecard-stage {
        display: grid;
        justify-items: start;
        padding: var(--space-6, 18px);
      }
    </style>
  </template>
}

export const DEMOS_NODE_CARD: Record<string, unknown> = {
  NodeCard: NodeCardUsage,
};
