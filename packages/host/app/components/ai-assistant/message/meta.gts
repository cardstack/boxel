import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { format as formatDate, formatISO } from 'date-fns';

import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    isFromAssistant?: boolean;
    isAvatarAnimated?: boolean;
    profileAvatar?: ComponentLike;
    datetime: Date;
  };
}

const MessageMeta: TemplateOnlyComponent<Signature> = <template>
  <section class='meta' ...attributes>
    {{#if @isFromAssistant}}
      {{! TODO: should be able to use Avatar component here too }}
      <div
        class='ai-avatar {{if @isAvatarAnimated "ai-avatar-animated"}}'
        aria-label='ai bot'
        data-test-ai-avatar
      />
    {{else if @profileAvatar}}
      <@profileAvatar />
    {{/if}}
    <time datetime={{formatISO @datetime}} class='time'>
      {{formatDate @datetime 'iiii MMM d, yyyy, h:mm aa'}}
    </time>
  </section>

  <style scoped>
    .meta {
      display: grid;
      grid-template-columns: var(--ai-assistant-message-avatar-size) 1fr;
      grid-template-rows: var(--ai-assistant-message-meta-height);
      align-items: center;
      gap: var(--ai-assistant-message-gap);
    }
    .ai-avatar {
      width: var(--ai-assistant-message-avatar-size);
      height: var(--ai-assistant-message-avatar-size);
      background-image: image-set(
        url('../ai-assist-icon.webp') 1x,
        url('../ai-assist-icon@2x.webp') 2x,
        url('../ai-assist-icon@3x.webp')
      );
      background-repeat: no-repeat;
      background-size: var(--ai-assistant-message-avatar-size);
    }
    .ai-avatar-animated {
      background-image: url('../ai-assist-icon-animated.webp');
    }
    .time {
      display: block;
      font: 500 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-sm);
      color: var(--boxel-450);
      white-space: nowrap;
    }
  </style>
</template>;

export default MessageMeta;
