// Pretui — Toolbar usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { Toolbar } from './toolbar';
import { Button } from './button';

// ── Toolbar ← header/usage.gts ───────────────────────────────────────────
// Dropped knobs: size (Toolbar has a single scale); hasBackground and
// hasBottomBorder (Toolbar is transparent chrome — no style args); icon
// block (no icon slot on Toolbar).
class ToolbarUsage extends GlimmerComponent {
  @tracked title = 'Title';
  @tracked eyebrow = 'pretui / structure';
  @tracked meta = 'usually shown at the top of card containers';
  setTitle = (v: string) => (this.title = v);
  setEyebrow = (v: string) => (this.eyebrow = v);
  setMeta = (v: string) => (this.meta = v);
  get usage() {
    let bits: string[] = [];
    if (this.eyebrow) bits.push(`@eyebrow='${this.eyebrow}'`);
    if (this.title) bits.push(`@title='${this.title}'`);
    if (this.meta) bits.push(`@meta='${this.meta}'`);
    return `<Toolbar ${bits.join(' ')}>…</Toolbar>`;
  }
  <template>
    <FreestyleUsage
      @name='Toolbar'
      @description='Usually shown at the top of card containers: an identity cluster (eyebrow, title, meta) with actions aligned to the end.'
      @source={{this.usage}}
    >
      <:example>
        <Toolbar
          @title={{this.title}}
          @eyebrow={{this.eyebrow}}
          @meta={{this.meta}}
          class='toolbar-box'
        >
          <Button @tone='neutral' @appearance='outlined' @size='s'>Options</Button>
          <Button @tone='primary' @size='s'>New</Button>
        </Toolbar>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @description='Title'
          @value={{this.title}}
          @onInput={{this.setTitle}}
        />
        <Args.String
          @name='eyebrow'
          @description='Mono uppercase overline rendered above the title.'
          @value={{this.eyebrow}}
          @onInput={{this.setEyebrow}}
        />
        <Args.String
          @name='meta'
          @description='Muted meta line rendered under the title.'
          @value={{this.meta}}
          @onInput={{this.setMeta}}
        />
        <Args.Yield
          @description='Content aligned to the end of the container — the header :detail block folds in here as the actions area.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .toolbar-box {
        width: 100%;
      }
    </style>
  </template>
}

export const DEMOS_TOOLBAR: Record<string, unknown> = {
  Toolbar: ToolbarUsage,
};
