declare module 'ember-click-outside/modifiers/on-click-outside' {
  import Modifier from 'ember-modifier';

  type Signature = {
    Args: {
      Named: {
        capture?: any;
        eventType?: any;
        exceptSelector?: any;
      };
      Positional: any;
    };
    Element: HTMLElement;
  };

  export default class onClickOutside extends Modifier<Signature> {}
}
