import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import { formats, type Format } from '@cardstack/runtime-common';

interface Signature {
  Args: {
    format: Format;
    setFormat: (format: Format) => void;
    additionalClass?: string;
    formats?: Format[];
  };
  Element: HTMLElement;
}

export default class FormatChooser extends Component<Signature> {
  <template>
    <div class='format-chooser' ...attributes>
      <div class='format-chooser__buttons'>
        {{#each this.formats as |format|}}
          <Button
            class={{cn 'format-chooser__button' active=(eq @format format)}}
            {{on 'click' (fn @setFormat format)}}
            data-test-format-chooser={{format}}
          >
            {{format}}
          </Button>
          {{! TODO in CS-8701: show indicator when custom template exists }}
        {{/each}}
      </div>
    </div>
    <style scoped>
      .format-chooser {
        height: var(--boxel-format-chooser-height);
        display: flex;
        justify-content: center;
        align-items: center;
        background-color: var(--boxel-dark);
      }

      .format-chooser__buttons {
        display: flex;
        justify-content: space-between;
        width: 100%;

        border: 0;
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-deep-box-shadow);
        padding: var(--boxel-sp-xxs);
      }

      .format-chooser__button {
        --boxel-button-color: transparent;
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-text-color: var(--boxel-light);
        min-height: unset;
        min-width: unset;
        padding-inline: var(--boxel-sp-xs);
        border-color: transparent;
        border-radius: var(--boxel-border-radius);
        text-transform: capitalize;
      }

      .format-chooser__button.active {
        --boxel-button-color: var(--boxel-light);
        --boxel-button-text-color: var(--boxel-dark);
      }
    </style>
  </template>

  private get formats() {
    return this.args.formats ?? formats;
  }
}
