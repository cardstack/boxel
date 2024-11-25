import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { Accordion, Button } from '@cardstack/boxel-ui/components';
import TriangleAlert from '@cardstack/boxel-icons/triangle-alert';

import { type CardError } from '../../resources/card-resource';

interface Signature {
  Args: {
    error: CardError['errors'][0];
  };
}

export default class CardErrorDetail extends Component<Signature> {
  @tracked showErrorDetail = false;

  // TODO centralize this somewhere
  get errorTitle() {
    return this.args.error.status === 404 &&
      // a missing link error looks a lot like a missing card error
      this.args.error.message.includes('missing')
      ? `Link Not Found`
      : this.args.error.title;
  }

  private toggleDetail = () => (this.showErrorDetail = !this.showErrorDetail);

  private viewInCodeMode = () => {
    // TODO
  };

  <template>
    <Accordion as |A|>
      <A.Item
        @onClick={{fn this.toggleDetail 'schema'}}
        @isOpen={{this.showErrorDetail}}
      >
        <:title>
          <TriangleAlert />
          An error was encountered on this card:
          <span class='error-detail'>{{this.errorTitle}}</span>
        </:title>
        <:content>
          <div class='actions'>
            <Button @kind='primary' {{on 'click' this.viewInCodeMode}}>View in
              Code Mode</Button>
          </div>
          <div class='detail'>
            <div class='detail-item'>
              <div class='detail-title'>Details:</div>
              <div class='detail-contents'>{{@error.message}}</div>
            </div>
            {{#if @error.meta.stack}}
              <div class='detail-item'>
                <div class='detail-title'>Stack trace:</div>
                <pre>
{{@error.meta.stack}}
                </pre>
              </div>
            {{/if}}
          </div>
        </:content>
      </A.Item>
    </Accordion>

    <style scoped>
      .actions {
        display: flex;
        justify-content: center;
        margin-top: var(--boxel-sp-lg);
      }
      .detail {
        padding: var(--boxel-sp);
      }
      .detail-item {
        margin-top: var(--boxel-sp);
      }
      .detail-title {
        font: 600 var(--boxel-font);
      }
      .detail-contents {
        font: var(--boxel-font);
      }
      pre {
        margin-top: 0;
        white-space: pre-wrap;
        word-break: break-all;
      }
    </style>
  </template>
}
