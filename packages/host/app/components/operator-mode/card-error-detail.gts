import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import { Accordion, Button } from '@cardstack/boxel-ui/components';
import TriangleAlert from '@cardstack/boxel-icons/triangle-alert';

import { dropTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import SwitchSubmodeCommand from '../../commands/switch-submode';
import { type CardError } from '../../resources/card-resource';
import type CommandService from '../../services/command-service';

interface Signature {
  Args: {
    error: CardError['errors'][0];
    title?: string;
  };
}

export default class CardErrorDetail extends Component<Signature> {
  @tracked private showErrorDetail = false;
  @service private declare commandService: CommandService;

  private toggleDetail = () => (this.showErrorDetail = !this.showErrorDetail);

  private viewInCodeMode = dropTask(async () => {
    let switchSubmodeCommand = new SwitchSubmodeCommand(
      this.commandService.commandContext,
    );
    const InputType = await switchSubmodeCommand.getInputType();
    let input = new InputType({
      submode: 'code',
      codePath: `${this.args.error.id}.json`,
    });
    await switchSubmodeCommand.execute(input);
  });

  <template>
    <Accordion as |A|>
      <A.Item
        @onClick={{fn this.toggleDetail 'schema'}}
        @isOpen={{this.showErrorDetail}}
      >
        <:title>
          <TriangleAlert />
          An error was encountered on this card:
          <span class='error-detail'>{{this.args.title}}</span>
        </:title>
        <:content>
          <div class='actions'>
            <Button
              @kind='primary'
              {{on 'click' (perform this.viewInCodeMode)}}
            >View in Code Mode</Button>
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
