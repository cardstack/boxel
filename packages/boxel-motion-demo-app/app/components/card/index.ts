/* eslint-disable @typescript-eslint/no-explicit-any */
import templateOnlyComponent from '@ember/component/template-only';

interface Signature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    model: any;
    hasImage: boolean;
    expandAction: () => void;
    format: string;
  };
}

const Card = templateOnlyComponent<Signature>();

export default Card;

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Card: typeof Card;
  }
}
