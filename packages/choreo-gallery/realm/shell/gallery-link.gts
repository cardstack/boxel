import { on } from '@ember/modifier';
import Component from '@glimmer/component';

interface Signature {
  Args: {
    href: string;
    /** called instead of following the link on a plain primary click */
    onFollow: () => void;
  };
  Blocks: { default: [] };
  Element: HTMLAnchorElement;
}

/**
 * A real link that the gallery follows itself. A plain click stays inside the
 * card, so the crossing can animate it; a modified click (new tab, new
 * window) is left to the browser and opens the card at its own URL.
 */
export class GalleryLink extends Component<Signature> {
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
    this.args.onFollow();
  };

  <template>
    <a href={{@href}} ...attributes {{on 'click' this.follow}}>{{yield}}</a>
  </template>
}
