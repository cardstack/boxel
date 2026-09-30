import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import { cssVar } from '@cardstack/boxel-ui/helpers';

import { observeWorkspaceTile } from '@cardstack/host/lib/workspace-tile-window';

interface Signature {
  Args: { index: number; selected: boolean; active: boolean };
  Blocks: { default: [] };
}

// Keep cheap, measurable slots in DOM order for keyboard navigation, while
// mounting the expensive tile UI and its wallpaper only near the viewport.
export default class TileWindow extends Component<Signature> {
  @tracked private nearby =
    typeof IntersectionObserver === 'undefined' || this.args.index < 24;
  @tracked private height = '14.5625rem';
  private get mounted() {
    return this.nearby || this.args.selected;
  }
  private observe = modifier((element: HTMLElement, [active]: [boolean]) => {
    if (!active || typeof IntersectionObserver === 'undefined') return;
    return observeWorkspaceTile(element, {
      intersect: (visible) => {
        if (this.nearby !== visible) this.nearby = visible;
      },
      resize: (height) => {
        let value = `${height}px`;
        if (this.height !== value) this.height = value;
      },
    });
  });

  <template>
    <div
      class='workspace-tile-window'
      data-nav-placeholder={{unless this.mounted @index}}
      style={{cssVar window-height=(unless this.mounted this.height)}}
      {{this.observe @active}}
    >
      {{#if this.mounted}}{{yield}}{{/if}}
    </div>
    <style scoped>
      .workspace-tile-window {
        width: var(--boxel-xxs-container);
        height: var(--window-height, auto);
        flex: 0 0 auto;
      }
    </style>
  </template>
}
