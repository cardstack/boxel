// Pretui — Dock usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import {
  Copy,
  Eye,
  Folder,
  Grid3x3,
  IconGlobe,
} from '@cardstack/boxel-ui/icons';
import { FreestyleUsage } from './freestyle-usage';
import { Dock } from './dock';

// ── Dock ← motion-primitives Dock ────────────────────────────────────────
// Live knob: size (the original's panelHeight/base width pair collapses
// to one square base size). Dropped surface: magnification + distance
// (the continuous cursor-distance window becomes the fixed 1.4/1.2/1.0
// sibling falloff), spring config (CSS transition instead), and the
// DockLabel tooltip subcomponent (items carry title= from @label). Item
// clicks land in @onClick — the readout below proves the wiring.
const DOCK_APPS = [
  { key: 'files', label: 'Files' },
  { key: 'preview', label: 'Preview' },
  { key: 'copy', label: 'Duplicate' },
  { key: 'grid', label: 'Grid view' },
  { key: 'publish', label: 'Publish' },
];

class DockUsage extends Component {
  apps = DOCK_APPS;
  @tracked size = 40;
  @tracked lastClicked: string | null = null;
  setSize = (v: number | null) => (this.size = v ?? 40);
  clickFiles = (_e: Event) => (this.lastClicked = 'Files');
  clickPreview = (_e: Event) => (this.lastClicked = 'Preview');
  clickCopy = (_e: Event) => (this.lastClicked = 'Duplicate');
  clickGrid = (_e: Event) => (this.lastClicked = 'Grid view');
  clickPublish = (_e: Event) => (this.lastClicked = 'Publish');
  get usage() {
    return `<Dock @size={{${this.size}}} @label='Card actions' as |d|>\n  <d.Item @label='Files' @onClick={{this.openFiles}}>\n    <FolderIcon width='100%' height='100%' />\n  </d.Item>\n</Dock>`;
  }
  <template>
    <FreestyleUsage
      @name='Dock'
      @description="Magnifying shortcut rail — a toolbar row of square item slots that scale up near the hovered item: hovered 1.4×, immediate neighbors 1.2×, the rest resting at 1.0×. CSS-only: the falloff is :hover plus sibling selectors (`+` for the next item, :has() for the previous), animated by a width/height transition that reduced-motion removes (magnification then snaps). Items grow upward out of the rail, pushing siblings apart. Transcribed from motion-primitives Dock, which magnifies continuously by cursor DISTANCE with spring physics — the documented delta of the discrete sibling cut."
      @source={{this.usage}}
    >
      <:example>
        <div class='dock-host'>
          <Dock @size={{this.size}} @label='Card actions' as |d|>
            <d.Item @label='Files' @onClick={{this.clickFiles}}>
              <Folder width='100%' height='100%' />
            </d.Item>
            <d.Item @label='Preview' @onClick={{this.clickPreview}}>
              <Eye width='100%' height='100%' />
            </d.Item>
            <d.Item @label='Duplicate' @onClick={{this.clickCopy}}>
              <Copy width='100%' height='100%' />
            </d.Item>
            <d.Item @label='Grid view' @onClick={{this.clickGrid}}>
              <Grid3x3 width='100%' height='100%' />
            </d.Item>
            <d.Item @label='Publish' @onClick={{this.clickPublish}}>
              <IconGlobe width='100%' height='100%' />
            </d.Item>
          </Dock>
          {{#if this.lastClicked}}
            <p class='dock-note'>Clicked: {{this.lastClicked}}</p>
          {{/if}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='size'
          @defaultValue={{40}}
          @value={{this.size}}
          @min={{28}}
          @max={{64}}
          @step={{4}}
          @description='Base (resting) item size in px — the magnified sizes are 1.2× and 1.4× of this.'
          @onInput={{this.setSize}}
        />
        <Args.String
          @name='label'
          @defaultValue='Dock'
          @description='Accessible label for the toolbar rail.'
          @hideControls={{true}}
        />
        <Args.Yield
          @description='Yields { Item } — a real button per slot. Item args: @label (required; aria-label + title tooltip), @onClick. The default block is the glyph — size it 100%×100% so it rides the magnification.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .dock-host {
        display: grid;
        gap: var(--space-3, 8px);
        justify-items: start;
        /* headroom for the 1.4× growth above the rail */
        padding-top: 28px;
      }
      .dock-note {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_DOCK: Record<string, unknown> = {
  Dock: DockUsage,
};
