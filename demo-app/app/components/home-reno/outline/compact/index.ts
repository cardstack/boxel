import templateOnlyComponent from '@ember/component/template-only';
import { COMPACT_CARD_STATES } from '../../card/compact';

interface Signature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    state: typeof COMPACT_CARD_STATES[keyof typeof COMPACT_CARD_STATES];
    toggleExpansion: (arg0: Event) => void;
    maximize?: (arg0: Event) => void;
  };
}

const HomeRenoOutlineCompact = templateOnlyComponent<Signature>();

export default HomeRenoOutlineCompact;

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'HomeReno::Outline::Compact': typeof HomeRenoOutlineCompact;
  }
}
