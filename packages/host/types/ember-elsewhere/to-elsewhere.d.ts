declare module 'ember-elsewhere/components/to-elsewhere' {
  import Component from '@glimmer/component';
  import { ComponentLike } from '@glint/template';

  type Signature = {
    Args: {
      named: string;
      send: ComponentLike;
      outsideParams?: any;
      order?: any;
    };
    Element: HTMLDivElement;
  };

  export default class ToElsewhere extends Component<Signature> {}
}
  