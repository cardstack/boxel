// AuthHeading: a screen's title as a real heading, `h1` unless `@level` is 2.
// A screen that a page can head with a title of its own takes the level from
// that page, so the page keeps a single level-1 heading.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { eq } from '../helpers/truth-helpers.ts';

interface Signature {
  Element: HTMLHeadingElement;
  Args: {
    level?: 1 | 2;
  };
  Blocks: { default: [] };
}

const AuthHeading: TemplateOnlyComponent<Signature> = <template>
  {{#if (eq @level 2)}}
    <h2 ...attributes>{{yield}}</h2>
  {{else}}
    <h1 ...attributes>{{yield}}</h1>
  {{/if}}
</template>;

export default AuthHeading;
