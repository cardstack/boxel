import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { UserBubble } from '@cardstack/pretui/components/user-bubble';

import { cn } from '@cardstack/boxel-ui/helpers';

import { sanitizedHtml } from '@cardstack/host/helpers/sanitized-html';

import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    html?: string;
    isPending?: boolean;
    /** who posted it, over the bubble; a room can hold several people */
    authorName?: string;
    /** the reader's own message: the name reads "You" */
    isSelf?: boolean;
    /** the same author as the message above: the name is not repeated */
    continued?: boolean;
    /** when it was sent; the bubble shows the time, and the full date in
     * a tooltip on it */
    timestamp?: Date;
    /** the author's profile avatar, the same mark as in the top bar */
    avatar?: ComponentLike;
  };
  /** the cards and files sent with it, over the text */
  Blocks: { attachments: [] };
}

// Pret UI's UserBubble, fed the host's message: the rendered HTML in its
// rich block, the attachments in its own slot over it, the author and time
// over both
const UserMessage: TemplateOnlyComponent<Signature> = <template>
  <UserBubble
    class={{cn 'user-message-bubble' is-pending=@isPending}}
    @author={{@authorName}}
    @self={{@isSelf}}
    @continued={{@continued}}
    @timestamp={{@timestamp}}
    @delivery={{if @isPending 'pending'}}
    data-test-user-message
    ...attributes
  >
    <:avatar>
      {{#if @avatar}}
        <@avatar />
      {{/if}}
    </:avatar>
    <:attachments>{{yield to='attachments'}}</:attachments>
    <:default>
      {{#if @html}}
        <div
          class='user-message-text'
          data-theme='light'
          data-test-user-message-text
        >
          {{sanitizedHtml @html}}
        </div>
      {{/if}}
    </:default>
  </UserBubble>

  <style scoped>
    /* the bubble's own block owns the type; the message's paragraphs sit
       12px apart, as an answer's do */
    .user-message-text {
      overflow-wrap: anywhere;
    }
    .user-message-text > :deep(*) {
      margin-block: 0;
    }
    .user-message-text > :deep(* + *) {
      margin-top: var(--step-12, 12px);
    }
    /* the bubble steps back on --inset (the kit's default), so its card
       and file pills are outlined tokens on that inset, in ink-1 */
    .user-message-bubble {
      /* `--boxel-pill-*` overrides win over the variant-class `--pill-*`
         declarations on the Pill element itself; setting the inner
         `--pill-*` vars here would be shadowed by `.variant-default` /
         `.variant-muted` further down the tree. */
      --boxel-pill-background-color: var(--inset);
      --boxel-pill-font-color: var(--foreground);
      --boxel-pill-border-radius: var(--round-row, 8px);
    }
    .is-pending {
      --boxel-pill-background-color: transparent;
      --boxel-pill-font-color: var(--ink-3);
    }
    /* the profile avatar, drawn at the speaker mark's 16px */
    .user-message-bubble {
      --profile-avatar-icon-size: 16px;
      --profile-avatar-icon-border: 0;
    }
    .user-message-text :deep(a:hover) {
      color: var(--pretui-link, var(--boxel-highlight-hover));
    }
  </style>
</template>;

export default UserMessage;
