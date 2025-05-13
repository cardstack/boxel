import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { sanitizeHtml } from '@cardstack/runtime-common/dompurify-runtime';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    html?: string;
  };
}

export default class FormattedUserMessage extends Component<Signature> {
  sanitizeHTML = (html?: string) => {
    return htmlSafe(sanitizeHtml(html ?? ''));
  };

  <template>
    {{log 'rendering FormattedUserMessage'}}
    <div class='message'>
      {{this.sanitizeHTML @html}}
    </div>

    <style scoped>
      .message {
        position: relative;
      }

      .message > :deep(*) {
        margin-top: 0;
      }
    </style>
  </template>
}
