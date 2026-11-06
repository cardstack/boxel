// Whom a key chosen for a card's calls serves, said beside the choice so a
// key of the user's own and a key they share with a workspace never read
// alike. The user's own key (a `userKey` slot) serves only them: everyone else
// who uses the card chooses a key of their own. A shared key (an `apiKey`
// slot) serves everyone who uses the card in the workspace, and its calls
// count against the share's limits; the workspace has one such key per slot,
// so approving one replaces the one chosen before.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Chip } from '@cardstack/pretui/components/chip';

import { eq } from '../../helpers/truth-helpers.ts';

interface Signature {
  Args: {
    kind: 'userKey' | 'apiKey';
  };
  Element: HTMLParagraphElement;
}

const KeyAudience: TemplateOnlyComponent<Signature> = <template>
  <p class='audience' data-test-key-audience={{@kind}} ...attributes>
    {{#if (eq @kind 'apiKey')}}
      <Chip
        class='who'
        @label='Everyone in this workspace'
        @tone='info'
        data-test-key-audience-who
      />
      <span class='what'>Boxel uses this key whenever anyone uses the card in
        this workspace, and their calls count against the share’s limits.
        Approving replaces any key chosen for these calls before.</span>
    {{else}}
      <Chip
        class='who'
        @label='Only you'
        @tone='neutral'
        data-test-key-audience-who
      />
      <span class='what'>Boxel uses this key only when you use the card.
        Everyone else who uses it chooses a key of their own.</span>
    {{/if}}
  </p>

  <style scoped>
    .audience {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--boxel-sp-4xs);
      margin: 0;
    }
    .what {
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      color: var(--muted-foreground);
    }
  </style>
</template>;

export default KeyAudience;
