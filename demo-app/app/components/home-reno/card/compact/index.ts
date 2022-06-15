import Component from '@glimmer/component';

export const COMPACT_CARD_STATES = {
  MINIMIZED: 'MINIMIZED',
  EXPANDED: 'EXPANDED',
  MAXIMIZED_PLACEHOLDER: 'MAXIMIZED_PLACEHOLDER',
} as const;

interface CompactCardArgs {
  state: typeof COMPACT_CARD_STATES[keyof typeof COMPACT_CARD_STATES];
  toggleExpansion: () => void;
  maximize: () => void;
}

export default class CompactCard extends Component<CompactCardArgs> {
  STATES = COMPACT_CARD_STATES;
}
