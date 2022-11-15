import templateOnlyComponent from '@ember/component/template-only';

import { COMPACT_CARD_STATES } from '../../card/compact';

interface Signature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    state: typeof COMPACT_CARD_STATES[keyof typeof COMPACT_CARD_STATES];
    toggleExpansion: (ev: Event) => void;
    maximize?: (ev: Event) => void;
  };
}

const HomeRenoGalleryCompact = templateOnlyComponent<Signature>();

export default HomeRenoGalleryCompact;

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'HomeReno::Gallery::Compact': typeof HomeRenoGalleryCompact;
  }
}
