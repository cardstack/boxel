declare module 'ember-set-body-class/helpers/set-body-class' {
  import type { HelperLike } from '@glint/template';

  interface Signature {
    Args: {
      Positional: [string];
    };
    Return: void;
  }

  const setBodyClass: HelperLike<Signature>;
  export default setBodyClass;
}
