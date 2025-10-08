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
    ariaLabel?: string;
    height?: string;
    textToCopy: string;
    width?: string;
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
    <Tooltip @placement='top' class='copy-button-tooltip'>
      <:trigger>
        <IconButton
          @icon={{Copy}}
          width={{unless @width '18px'}}
          height={{unless @height '18px'}}
          {{on 'click' this.copyToClipboard}}
          aria-label='{{if
            this.recentlyCopied
            "Copied!"
            (if @ariaLabel @ariaLabel "Copy to clipboard")
          }}'
          aria-labelledby='copy-button-content'
          data-test-boxel-copy-button
          ...attributes
        />
      </:trigger>
      <:content>
        <span id='copy-button-content'>
          {{if this.recentlyCopied 'Copied!' 'Copy to clipboard'}}
        </span>
      </:content>
    </Tooltip>
  </template>
}
