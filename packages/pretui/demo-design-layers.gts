// Pretui — demo-design-layers: usage pages for LayerManager.
//
// The page is deliberately a WORKING panel rather than a static specimen:
// the tree is tracked local state, `@onLayersChange` writes it back, and so
// every move, every visibility flip and every lock survives. A layers panel
// demonstrated with a frozen tree proves nothing — the whole question is
// whether the reorder actually lands where it was announced.
//
// Try it from the keyboard, which is the point of the component: Tab into
// the panel, arrow to a handle, press Enter, then ↑ ↓ to reorder, → to nest
// the layer inside the one above it, ← to move it back out, Enter to drop,
// Escape to put it back. Nothing here needs a pointer.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { FreestyleUsage } from './components/freestyle-usage';
import { LayerManager } from './components/layer-manager';
import type { LayerNode } from './components/layer-manager';

// ── Fixture ──────────────────────────────────────────────────────────────

/** A plausible artboard: nested groups, a masked image, one layer already
 * hidden and one already locked, and — the case worth having on the page —
 * a hidden GROUP whose children inherit the hiding without their own flags
 * being touched. */
export const ARTBOARD: readonly LayerNode[] = [
  {
    id: 'nav',
    name: 'Nav bar',
    kind: 'frame',
    children: [
      { id: 'nav-logo', name: 'Wordmark', kind: 'vector' },
      { id: 'nav-links', name: 'Links', kind: 'text' },
      { id: 'nav-cta', name: 'Sign in button', kind: 'component' },
    ],
  },
  {
    id: 'hero',
    name: 'Hero',
    kind: 'frame',
    children: [
      { id: 'hero-head', name: 'Headline', kind: 'text' },
      { id: 'hero-sub', name: 'Subhead', kind: 'text' },
      {
        id: 'hero-art',
        name: 'Cover art',
        kind: 'group',
        hidden: true,
        children: [
          { id: 'hero-plate', name: 'Plate photograph', kind: 'image' },
          { id: 'hero-mask', name: 'Rounded mask', kind: 'mask' },
        ],
      },
    ],
  },
  { id: 'grid-guides', name: 'Layout guides', kind: 'shape', locked: true },
  { id: 'bg', name: 'Page background', kind: 'shape' },
];

// ── Inherited state ──────────────────────────────────────────────────────

class LayerInheritanceDemo extends Component {
  @tracked layers: readonly LayerNode[] = ARTBOARD;

  takeLayers = (next: LayerNode[]) => {
    this.layers = next;
  };

  get usage(): string {
    return [
      '<LayerManager',
      '  @layers={{this.layers}}',
      '  @onLayersChange={{this.takeLayers}}',
      "  @density='compact'",
      "  @selectionMode='none'",
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='LayerManager — inherited state'
      @description="Cover art is hidden, and so its two children are hidden — but neither child's own flag was touched. Most panels show the child as visible, which means the panel and the canvas disagree: the reader sees nothing on screen and a row that says the layer is showing. Here the row resolves the effective state, the word beside the name says which, and the child's eye button announces itself as 'Show Plate photograph — hidden by Cover art' rather than reporting a flag with no effect. Layout guides shows the same idea for lock. Toggle Cover art and watch both children change with it without their own flags moving."
      @source={{this.usage}}
    >
      <:example>
        <LayerManager
          @layers={{this.layers}}
          @onLayersChange={{this.takeLayers}}
          @density='compact'
          @selectionMode='none'
          @label='Inherited visibility and lock'
        />
      </:example>

      <:api as |Args|>
        <Args.Array
          @name='layers'
          @value={{this.layers}}
          @description='The same artboard. Cover art carries hidden, Layout guides carries locked, and nothing else does.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

// ── The registry ─────────────────────────────────────────────────────────

export const DEMOS_DESIGN_LAYERS: Record<string, unknown> = {
  LayerInheritance: LayerInheritanceDemo,
};
