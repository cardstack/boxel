// Glint's template types, for the package's `.gts` components.
import 'ember-source/types';
import '@glint/ember-tsc/types';

import type { HelperLike, ModifierLike } from '@glint/template';
import type { InvokeDirect } from '@glint/template/-private/integration';
import type { ConcatHelper as GlintConcatHelper } from '@glint/ember-tsc/-private/intrinsics/concat';
import type { FnHelper as GlintFnHelper } from '@glint/ember-tsc/-private/intrinsics/fn';
import type {
  EventForName,
  OnModifierArgs,
} from '@glint/ember-tsc/-private/intrinsics/on';

declare global {
  // glimmer-scoped-css's `<style scoped>`, which Glint's element types don't
  // name.
  interface HTMLStyleElementAttributes {
    ['scoped']: string | boolean | null | undefined;
  }
}

// `ember-source` types its template intrinsics (`on`, `concat`, `fn`) as
// opaque values, and Glint's own augmentation doesn't reach the values they
// are exported as. These give them the shape Glint invokes, as
// `@cardstack/local-types` does for the host and boxel-ui.
declare module '@ember/helper' {
  interface FnHelper {
    [InvokeDirect]: GlintFnHelper[typeof InvokeDirect];
  }

  interface ConcatHelper
    extends
      GlintConcatHelper,
      HelperLike<{
        Args: { Positional: unknown[] };
        Return: string;
      }> {}
}

declare module '@ember/modifier/on' {
  interface OnModifier extends ModifierLike<{
    Element: Element;
    Args: {
      Named: OnModifierArgs;
      Positional: [
        name: string,
        callback: (event: EventForName<string>) => void,
      ];
    };
  }> {}
}
