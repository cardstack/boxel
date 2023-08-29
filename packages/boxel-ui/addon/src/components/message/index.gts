import type { TemplateOnlyComponent } from '@ember/component/template-only';
import dayjs from 'dayjs';

import cn from '../../helpers/cn.ts';
import { dayjsFormat } from '../../helpers/dayjs-format.ts';
import { svgJar } from '../../helpers/svg-jar.ts';

interface Signature {
  Args: {
    datetime?: any;
    fullWidth?: boolean;
    hideMeta?: boolean;
    hideName?: boolean;
    imgURL?: string;
    name?: string;
    notRound?: boolean;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

const Message: TemplateOnlyComponent<Signature> = <template>
  <div
    class={{cn 'boxel-message' hide-meta=@hideMeta full-width=@fullWidth}}
    data-test-boxel-message
    ...attributes
  >
    <div class={{cn 'meta' boxel-sr-only=@hideMeta}}>
      {{#unless @hideMeta}}
        {{#if @imgURL}}
          <img
            src={{@imgURL}}
            alt={{if @name @name 'participant'}}
            width='40px'
            height='40px'
            class={{cn 'avatar-img' avatar-img--not-round=@notRound}}
            data-test-boxel-message-avatar
          />
        {{else}}
          {{svgJar
            'profile'
            width='40px'
            height='40px'
            aria-label=(if @name @name 'participant')
          }}
        {{/if}}
      {{/unless}}
      <h3 class='info'>
        {{#if @name}}
          <span
            class={{cn 'name' boxel-sr-only=@hideName}}
            data-test-boxel-message-name
          >
            {{@name}}
          </span>
        {{/if}}
        {{#let (if @datetime @datetime (dayjs)) as |datetime|}}
          <time datetime={{datetime}} class='time'>
            {{dayjsFormat datetime 'MM/DD/YYYY, h:mm A'}}
          </time>
        {{/let}}
      </h3>
    </div>
    <div class='content'>
      {{yield}}
    </div>
  </div>
  <style>
    .boxel-message {
      /* Note: avatar size should not be set to be larger than 60px or smaller than 20px. */
      --boxel-message-avatar-size: 2.5rem; /* 40px. */
      --boxel-message-meta-height: 1.25rem; /* 20px */
      --boxel-message-gap: var(--boxel-sp);
      --boxel-message-margin-left: calc(
        var(--boxel-message-avatar-size) + var(--boxel-message-gap)
      );
    }

    .hide-meta {
      min-height: 0;
    }

    .meta {
      display: grid;
      grid-template-columns: var(--boxel-message-avatar-size) 1fr;
      grid-template-rows: var(--boxel-message-meta-height);
      align-items: start;
      gap: var(--boxel-message-gap);
    }

    .full-width .meta {
      align-items: center;
    }

    .avatar-img {
      width: var(--boxel-message-avatar-size);
      height: var(--boxel-message-avatar-size);
      border-radius: 100px;
    }

    .avatar-img--not-round {
      border-radius: initial;
    }

    .info {
      display: flex;
      white-space: nowrap;
      margin: 0;
      font: var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp-sm);
    }

    .name {
      margin-right: var(--boxel-sp);
      font-weight: 700;
    }

    .time {
      color: var(--boxel-500);
    }

    .content {
      /* mimic the grid using margins */
      margin-left: var(--boxel-message-margin-left);
      margin-top: 3px;
      line-height: 1.5;
    }

    .full-width .content {
      margin-left: 0;
      margin-top: var(--boxel-sp);
    }

    /* spacing for sequential thread messages */
    .boxel-message + .boxel-message {
      margin-top: var(--boxel-sp-xl);
    }

    .boxel-message + .hide-meta {
      margin-top: var(--boxel-sp);
    }
  </style>
</template>;

export default Message;
