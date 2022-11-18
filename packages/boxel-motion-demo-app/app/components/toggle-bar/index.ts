import templateOnlyComponent from '@ember/component/template-only';

interface Signature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    onToggle: () => void;
    enabled: boolean;
  };
  Blocks: {
    default: [];
  };
}

const ToggleBar = templateOnlyComponent<Signature>();

export default ToggleBar;

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    ToggleBar: typeof ToggleBar;
  }
}
