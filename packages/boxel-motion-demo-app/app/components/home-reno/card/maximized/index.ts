import templateOnlyComponent from '@ember/component/template-only';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    minimize?: (arg0: Event) => void;
  };
  Blocks: {
    default: [];
  };
}

const HomeRenoCardMaximized = templateOnlyComponent<Signature>();

export default HomeRenoCardMaximized;

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'HomeReno::Card::Maximized': typeof HomeRenoCardMaximized;
  }
}
