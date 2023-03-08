import type { TemplateOnlyComponent } from '@ember/component/template-only';
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

const Message: TemplateOnlyComponent<Signature> = <template>
  <div
    class={{cn
      'boxel-thread-message'
      boxel-thread-message--hide-meta=@hideMeta
      boxel-thread-message--full-width=@fullWidth
    }}
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
