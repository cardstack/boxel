import Modifier from 'ember-modifier';

interface Signature {
  Element: HTMLElement;
  Args: {
    Positional: [keyCombo: string, callback?: (ev: KeyboardEvent) => void];
    Named: {
      event?: string;
      activated?: boolean;
      priority?: number;
    };
  };
}

export default class OnKeyHelper extends Modifier<Signature> {}
