# Animating Layout

Layout animation connects two layouts of the same interface. Your application changes the DOM or CSS once. Motion measures the before and after positions and animates the difference.

## Moving an Existing Element

Add `layout=true` to an element whose size or position changes. For example, a card can grow when its details become visible.

```gts title="app/components/expandable-card.gts"
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { LayoutGroup, motion, styles } from 'glimmer-motion';

export class ExpandableCard extends Component {
  @tracked expanded = false;

  toggle = () => {
    this.expanded = !this.expanded;
  };

  <template>
    <LayoutGroup>
      <article {{motion layout=true style=(styles borderRadius='14px')}}>
        <button
          type='button'
          aria-expanded={{this.expanded}}
          {{on 'click' this.toggle}}
        >
          Project details
        </button>
        {{#if this.expanded}}
          <p>The next review is on Friday.</p>
        {{/if}}
      </article>
    </LayoutGroup>
  </template>
}
```

Clicking the button changes the card's height. The modifier animates the card to its new bounds. Its border radius is declared through `style` so the engine can correct the corners during scaling.

## Connecting Two Representations

Use the same `layoutId` when two elements represent the same thing in different places, such as an image thumbnail and its expanded view. Keep the identity specific to that image.

```gts title="Shared Identity — Template Excerpt"
{{#if this.expanded}}
  <figure {{motion layoutId='project-photo'}}>…</figure>
{{else}}
  <button type="button" {{motion layoutId='project-photo'}}>…</button>
{{/if}}
```

This excerpt assumes `motion` is imported in the component. Only one representation is rendered at a time. See the [lightbox demo](/lightbox) for the complete interaction.

## Coordinating Related Elements

Wrap related layout participants in `LayoutGroup` when they need to measure a shared layout change together. A filtered grid is a common example: the remaining cards move to their new positions while their real content stays mounted.

For a destination that represents a place, such as a trash bin, use [a beacon](/docs/interactive-beacons). Shared identity means “the same item appears here”; a beacon means “move this item here.”

## Checking the Measurement Boundary

LayoutGroup also supplies the render observation that lets the binding capture old bounds before Glimmer changes the DOM. snapshotOnRender and closestLayoutGroup expose parts of that integration for specialized hosts; ordinary examples should use the component rather than duplicating the measurement pipeline. Outside an observing group, layoutChange wraps the state mutation that causes the reflow. Check layoutDependency when an element should only remeasure for a meaningful input, and use layoutScroll or layoutRoot where the actual container requires them. A working unscrolled fixture does not prove the same transition will land correctly in a fixed or scrolling panel.

## API Coverage

**glimmer-motion**: `layoutChange`, `closestLayoutGroup`, `LayoutGroup`, `snapshotOnRender`.

Read the implementation: [`layout.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/layout.ts), [`layout-group.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/layout-group.gts).
