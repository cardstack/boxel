import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';

import Copy from '../../icons/copy.gts';
import IconButton from '../icon-button/index.gts';
import Tooltip from '../tooltip/index.gts';

interface Signature {
  Args: {
    textToCopy: string;
  };
  Element: HTMLElement;
}

export default class CopyButton extends Component<Signature> {
  @tracked recentlyCopied = false;

  @task
  private *copyToClipboardTask(this: CopyButton) {
    yield navigator.clipboard.writeText(this.args.textToCopy);
    this.recentlyCopied = true;

    setTimeout(() => (this.recentlyCopied = false), 2000);
  }

  @action
  private copyToClipboard() {
    taskFor(this.copyToClipboardTask).perform();
  }

  <template>
    <Tooltip @placement='top' class='editability-icon'>
      <:trigger>
        <IconButton
          @icon={{Copy}}
          @width='18px'
          @height='18px'
          {{on 'click' this.copyToClipboard}}
          aria-label='Copy'
          data-test-boxel-copy-button
        />
      </:trigger>
      <:content>
        {{if this.recentlyCopied 'Copied!' 'Copy to clipboard'}}
      </:content>
    </Tooltip>
  </template>
}
