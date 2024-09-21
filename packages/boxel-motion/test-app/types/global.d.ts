import '@glint/environment-ember-loose';
import '@cardstack/boxel-motion/glint';
import type BoxelMotionRegistry from '@cardstack/boxel-motion/template-registry';

import { HelperLike } from '@glint/template';
import AndHelper from 'ember-truth-helpers/helpers/and';
import EqHelper from 'ember-truth-helpers/helpers/eq';
import NotHelper from 'ember-truth-helpers/helpers/not';
import OrHelper from 'ember-truth-helpers/helpers/or';

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry extends BoxelMotionRegistry {
    eq: typeof EqHelper;
    and: typeof AndHelper;
    or: typeof OrHelper;
    not: typeof NotHelper;
    'page-title': HelperLike<{
      Args: { Positional: [title: string] };
      Return: void;
    }>;
    'on-key': HelperLike<{
      Args: {
        Positional: [keyCombo: string, callback: () => void];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Named: { event: any };
      };
      Return: void;
    }>;
  }
}
