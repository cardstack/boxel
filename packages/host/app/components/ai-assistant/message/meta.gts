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
    {{! the transcript's one time format, "11:03 PM"; the full date is on
        hover }}
    <time
      datetime={{formatISO @datetime}}
      title={{formatDate @datetime 'iiii MMM d, yyyy, h:mm aa'}}
      class='time'
    >
      {{formatDate @datetime 'h:mm aa'}}
    </time>
  </section>

  <style scoped>
    /* on the spine: the mark in a 16px column at the transcript's edge,
       the time on the 40px text edge */
    .meta {
      display: grid;
      grid-template-columns: var(--step-16, 16px) 1fr;
      grid-template-rows: minmax(var(--ai-assistant-message-meta-height), auto);
      align-items: center;
      justify-items: start;
      column-gap: var(--step-8, 8px);
    }
    .meta > .time {
      justify-self: stretch;
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
    /* a time is a caption: sans, ink-3, tabular figures */
    .time {
      display: block;
      font-size: var(--type-caption, 11px);
      line-height: var(--leading-caption, 16px);
      font-weight: 400;
      font-variant-numeric: tabular-nums;
      color: var(--ink-3);
      white-space: nowrap;
    }
  </style>
</template>;

export default MessageMeta;
