import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { initStyleSheet, attachStyles } from '../attach-styles';
import cn from '../helpers/cn';
import { svgJar } from '../helpers/svg-jar';
import { dayjsFormat } from '../helpers/dayjs-format';
import dayjs from 'dayjs';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    imgURL?: string;
    name?: string;
    hideMeta?: boolean;
    hideName?: boolean;
    notRound?: boolean;
    fullWidth?: boolean;
    datetime?: any;
  };
  Blocks: {
    default: [];
  };
}

let styles = initStyleSheet(`
  .boxel-thread-message {
    /* Note: avatar size should not be set to be larger than 60px or smaller than 20px. */
    --boxel-thread-message-avatar-size: 2.5rem; /* 40px. */
    --boxel-thread-message-meta-height: 1.25rem; /* 20px */
    --boxel-thread-message-gap: var(--boxel-sp);
    --boxel-thread-message-margin-left: calc(var(--boxel-thread-message-avatar-size) + var(--boxel-thread-message-gap));
  }

  .boxel-thread-message--hide-meta {
    min-height: 0;
  }

  .boxel-thread-message__meta {
    display: grid;
    grid-template-columns: var(--boxel-thread-message-avatar-size) 1fr;
    grid-template-rows: var(--boxel-thread-message-meta-height);
    align-items: start;
    gap: var(--boxel-thread-message-gap);
  }

  .boxel-thread-message--full-width .boxel-thread-message__meta {
    align-items: center;
  }

  .boxel-thread-message__avatar-img {
    width: var(--boxel-thread-message-avatar-size);
    height: var(--boxel-thread-message-avatar-size);
    border-radius: 100px;
  }

  .boxel-thread-message__avatar-img--not-round {
    border-radius: initial;
  }

  .boxel-thread-message__info {
    display: flex;
    white-space: nowrap;
    margin: 0;
    font: var(--boxel-font-sm);
    letter-spacing: var(--boxel-lsp-sm);
  }

  .boxel-thread-message__name {
    margin-right: var(--boxel-sp);
    font-weight: 700;
  }

  .boxel-thread-message__time {
    color: var(--boxel-500);
  }

  .boxel-thread-message__content {
    /* mimic the grid using margins */
    margin-left: var(--boxel-thread-message-margin-left);
    margin-top: 3px;
    line-height: 1.5;
  }

  .boxel-thread-message--full-width .boxel-thread-message__content {
    margin-left: 0;
    margin-top: var(--boxel-sp);
  }

  /* spacing for sequential thread messages */
  .boxel-thread-message + .boxel-thread-message {
    margin-top: var(--boxel-sp-xl);
  }

  .boxel-thread-message + .boxel-thread-message--hide-meta {
    margin-top: var(--boxel-sp);
  }
`);

const Message: TemplateOnlyComponent<Signature> = <template>
  <div
    class={{cn
      'boxel-thread-message'
      boxel-thread-message--hide-meta=@hideMeta
      boxel-thread-message--full-width=@fullWidth
    }}
    {{attachStyles styles}}
    data-test-boxel-thread-message
    ...attributes
  >
    <div class={{cn 'boxel-thread-message__meta' boxel-sr-only=@hideMeta}}>
      {{#unless @hideMeta}}
        {{#if @imgURL}}
          <img
            src={{@imgURL}}
            alt={{if @name @name 'participant'}}
            width='40px'
            height='40px'
            class={{cn
              'boxel-thread-message__avatar-img'
              boxel-thread-message__avatar-img--not-round=@notRound
            }}
            data-test-boxel-thread-message-avatar
          />
        {{else}}
          {{svgJar
            'participant'
            width='40px'
            height='40px'
            aria-label=(if @name @name 'participant')
          }}
        {{/if}}
      {{/unless}}
      <h3 class='boxel-thread-message__info'>
        {{#if @name}}
          <span
            class={{cn 'boxel-thread-message__name' boxel-sr-only=@hideName}}
            data-test-boxel-thread-message-name
          >
            {{@name}}
          </span>
        {{/if}}
        {{#let (if @datetime @datetime (dayjs)) as |datetime|}}
          <time datetime={{datetime}} class='boxel-thread-message__time'>
            {{dayjsFormat datetime 'MM/DD/YYYY, h:mm A'}}
          </time>
        {{/let}}
      </h3>
    </div>
    <div class='boxel-thread-message__content'>
      {{yield}}
    </div>
  </div>
</template>;

export default Message;
