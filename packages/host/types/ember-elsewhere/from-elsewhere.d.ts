declare module 'ember-elsewhere/components/from-elsewhere' {
  import Component from '@glimmer/component';

  type Signature = {
    Args: {
      name: string
    };
    Element: HTMLDivElement;
  };

  export default class FromElsewhere extends Component<Signature> {}
}
