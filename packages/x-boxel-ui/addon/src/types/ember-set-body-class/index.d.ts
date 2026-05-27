declare module 'ember-set-body-class/helpers/set-body-class' {
  import { HelperLike } from '@glint/template';

  interface SetBodyClassHelperSignature {
    Args: { Positional: [string] };
    Return: never;
  }

  const SetBodyClassHelper: HelperLike<SetBodyClassHelperSignature>;

  export default SetBodyClassHelper;
}
