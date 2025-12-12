declare module 'ember-css-url' {
  import { HelperLike } from '@glint/template';
  import type { SafeString } from '@ember/template';

  interface Signature {
    Args: {
      Positional: [string, string];
    };
    Return: SafeString;
  }

  const EmberCssUrl: HelperLike<Signature>;

  export default EmberCssUrl;
}
