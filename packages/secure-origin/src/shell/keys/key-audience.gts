// Whom a key chosen for a card's calls serves, said beside the choice so a
// key of the user's own and a key they share with a workspace never read
// alike.
//
// The user's own key (a `userKey` slot) serves only them: everyone else who
// uses the card chooses a key of their own. A shared key (an `apiKey` slot)
// serves the card's calls in the workspace whoever makes them; the workspace
// has one such key per slot, so approving one replaces the one chosen before.
//
// What it serves follows when the calls run (`@use`). Approved for open cards
// too, a share serves everyone who uses the card in the workspace, and their
// calls count against the share's limits; where the realm's policy and the
// share's key let people who aren't signed in make the calls (`@anonymous`),
// it serves them as well. Approved for the schedule only, a key serves the
// card's scheduled calls alone: opening the card doesn't use it, and those
// calls count against no limits. With no `@use` (the use page, before the
// choice is made) it says only whose calls the key is for.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Chip } from '@cardstack/pretui/components/chip';

import { eq } from '../../helpers/truth-helpers.ts';

interface Signature {
  Args: {
    kind: 'userKey' | 'apiKey';
    use?: 'interactive' | 'pipelines';
    anonymous?: boolean;
  };
  Element: HTMLParagraphElement;
}

const KeyAudience: TemplateOnlyComponent<Signature> = <template>
  <p class='audience' data-test-key-audience={{@kind}} ...attributes>
    {{#if (eq @kind 'apiKey')}}
      {{#if (eq @use 'pipelines')}}
        <Chip
          @label='The card’s schedule in this workspace'
          @tone='info'
          data-test-key-audience-who
        />
        <span class='what'>Boxel uses this key only for the card’s scheduled
          calls in this workspace. Opening the card doesn’t use it, and
          scheduled calls don’t count against the share’s limits. Approving
          replaces any key chosen for these calls before.</span>
      {{else if @anonymous}}
        <Chip
          @label='Anyone, signed in or not'
          @tone='warning'
          data-test-key-audience-who
        />
        <span class='what'>Boxel uses this key whenever anyone uses the card in
          this workspace, including people who aren’t signed in, and their calls
          count against the share’s limits. Approving replaces any key chosen
          for these calls before.</span>
      {{else if (eq @use 'interactive')}}
        <Chip
          @label='Everyone in this workspace'
          @tone='info'
          data-test-key-audience-who
        />
        <span class='what'>Boxel uses this key whenever anyone uses the card in
          this workspace, and their calls count against the share’s limits.
          Approving replaces any key chosen for these calls before.</span>
      {{else}}
        <Chip
          @label='Everyone in this workspace'
          @tone='info'
          data-test-key-audience-who
        />
        <span class='what'>Boxel uses this key for the card’s calls in this
          workspace, whoever makes them, in place of any key chosen for those
          calls before.</span>
      {{/if}}
    {{else}}
      <Chip @label='Only you' @tone='neutral' data-test-key-audience-who />
      {{#if (eq @use 'pipelines')}}
        <span class='what'>Boxel uses this key only for the card’s scheduled
          calls you approve here. Opening the card doesn’t use it, and everyone
          else who uses the card chooses a key of their own.</span>
      {{else if (eq @use 'interactive')}}
        <span class='what'>Boxel uses this key only when you use the card.
          Everyone else who uses it chooses a key of their own.</span>
      {{else}}
        <span class='what'>Boxel uses this key only for your use of the card.
          Everyone else who uses it chooses a key of their own.</span>
      {{/if}}
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
