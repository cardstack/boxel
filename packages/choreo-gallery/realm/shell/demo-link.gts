import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import type { GalleryDemo } from '../demo';

interface Signature {
  Args: {
    demo: GalleryDemo;
    /** opens the demo card through the host */
    onOpen: (demo: GalleryDemo) => void;
  };
  Blocks: { default: [] };
  Element: HTMLAnchorElement;
}

/**
 * A link to another demo's card. A plain click hands the card to the host,
 * which opens it in the stack (or, on a published site, as the next page);
 * a modified click (new tab, new window) is left to the browser and opens the
 * card at its own URL.
 */
export class DemoLink extends Component<Signature> {
  follow = (event: Event) => {
    if (
      !(event instanceof MouseEvent) ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    this.args.onOpen(this.args.demo);
  };

  <template>
    <a href={{@demo.id}} ...attributes {{on 'click' this.follow}}>{{yield}}</a>
  </template>
}
