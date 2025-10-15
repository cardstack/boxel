import Copy from '@cardstack/boxel-icons/copy';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type { MiddlewareState } from '@floating-ui/dom';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import IconButton from '../icon-button/index.gts';
import Tooltip from '../tooltip/index.gts';

interface Signature {
  Args: {
    ariaLabel?: string;
    height?: string;
    offset?: number;
    placement?: MiddlewareState['placement'];
    textToCopy: string;
    width?: string;
  };
  Element: HTMLElement;
}

export default class CopyButton extends Component<Signature> {
  @tracked private recentlyCopied = false;

  @action private async copyToClipboard() {
    try {
      await navigator.clipboard.writeText(this.args.textToCopy);
      this.recentlyCopied = true;

      setTimeout(() => (this.recentlyCopied = false), 2000);
    } catch (error: unknown) {
      console.error(error instanceof Error ? error.message : error);
    }
  }

  <template>
    <Tooltip
      @placement={{@placement}}
      @offset={{@offset}}
      class='boxel-copy-button-tooltip'
      ...attributes
    >
      <:trigger>
        <IconButton
          @icon={{Copy}}
          @width={{@width}}
          @height={{@height}}
          {{on 'click' this.copyToClipboard}}
          class='boxel-copy-button'
          aria-label={{if
            this.recentlyCopied
            'Copied'
            (if @ariaLabel @ariaLabel 'Copy to clipboard')
          }}
          data-test-boxel-copy-button
        />
      </:trigger>
      <:content>
        <span>
          {{if this.recentlyCopied 'Copied!' 'Copy to clipboard'}}
        </span>
      </:content>
    </Tooltip>
  </template>
}
