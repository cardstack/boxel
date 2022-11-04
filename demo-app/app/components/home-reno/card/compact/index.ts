import Component from '@glimmer/component';

export const COMPACT_CARD_STATES = {
  MINIMIZED: 'MINIMIZED',
  EXPANDED: 'EXPANDED',
  MAXIMIZED_PLACEHOLDER: 'MAXIMIZED_PLACEHOLDER',
} as const;

interface Signature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    state: typeof COMPACT_CARD_STATES[keyof typeof COMPACT_CARD_STATES];
    toggleExpansion: (ev: Event) => void;
    maximize?: (ev: Event) => void;
    identifier: string;
  };
  Blocks: {
    default: [];
  };
}

export default class HomeRenoCardCompact extends Component<Signature> {
  STATES = COMPACT_CARD_STATES;
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'HomeReno::Card::Compact': typeof HomeRenoCardCompact;
  }
}
