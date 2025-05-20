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
          {{! FIXME green dot now required when card has a custom format… future PR? }}
        {{/each}}
      </div>
    </div>
    <style scoped>
      .format-chooser {
        display: flex;
        justify-content: center;
        background-color: var(--boxel-dark);
        margin: 0 auto;
      }

      .format-chooser__buttons {
        display: flex;
        justify-content: space-around;

        width: 380px;
        border: 0;
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-deep-box-shadow);
        padding: var(--boxel-spacing-xs);
      }

      .format-chooser__button {
        --boxel-button-color: var(
          --boxel-format-chooser-button-bg-color,
          transparent
        );
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-text-color: var(--boxel-light);
        padding: var(--boxel-sp-xxs);
        margin: var(--boxel-sp-xxs);
        min-width: unset;
        border: 1px solid
          var(--boxel-format-chooser-border-color, var(--boxel-700));
        border-left: 0;
        border-radius: initial;
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
