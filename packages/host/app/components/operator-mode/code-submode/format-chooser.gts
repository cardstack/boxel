import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Modifier from 'ember-modifier';

import { Button } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import type { Format } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    format: Format;
    setFormat: (format: Format) => void;
    additionalClass?: string;
    formats?: Format[];
  };
  Element: HTMLElement;
}

const formats: Format[] = ['isolated', 'embedded', 'fitted', 'atom', 'edit'];

export default class FormatChooser extends Component<Signature> {
  <template>
    <div
      class='format-chooser'
      {{ResizeModifier setFormatChooserWidthPx=this.setFormatChooserWidthPx}}
      ...attributes
    >
      <div class='format-chooser__buttons {{this.footerButtonsClass}}'>
        {{#each this.formats as |format|}}
          <Button
            class={{cn 'format-chooser__button' active=(eq @format format)}}
            {{on 'click' (fn @setFormat format)}}
            data-test-format-chooser={{format}}
          >
            {{format}}
          </Button>
        {{/each}}
      </div>
    </div>
    <style scoped>
      .format-chooser {
        display: flex;
        justify-content: center;
      }
      .format-chooser__buttons {
        display: flex;

        border: 0;
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-deep-box-shadow);
      }
      .format-chooser__buttons.collapsed {
        display: block;
        gap: var(--boxel-sp-sm);
        width: 100% - calc(2 * var(--boxel-sp));
      }
      .format-chooser__buttons.collapsed .format-chooser__button {
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-xs);
        border-radius: 6px;
        margin-top: var(--boxel-sp-xxxs);
        margin-right: var(--boxel-sp-xxs);
        border: 1px solid
          var(--boxel-format-chooser-border-color, var(--boxel-700));
      }
      .format-chooser__button:first-of-type {
        border-radius: var(--boxel-border-radius) 0 0 var(--boxel-border-radius);
        border-left: 1px solid
          var(--boxel-format-chooser-border-color, var(--boxel-700));
      }
      .format-chooser__button:last-of-type {
        border-radius: 0 var(--boxel-border-radius) var(--boxel-border-radius) 0;
      }
      .format-chooser__button {
        --boxel-button-color: var(
          --boxel-format-chooser-button-bg-color,
          transparent
        );
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-min-width: var(--boxel-format-chooser-button-min-width);
        width: var(--boxel-format-chooser-button-width);
        padding: var(--boxel-sp-xs);
        border: 1px solid
          var(--boxel-format-chooser-border-color, var(--boxel-700));
        border-left: 0;
        border-radius: initial;
        text-transform: capitalize;
      }
      .format-chooser__button.active {
        --boxel-button-color: var(--boxel-700);
        --boxel-button-text-color: var(--boxel-highlight);
      }
    </style>
  </template>

  @tracked formatChooserWidthPx = 0;

  @action setFormatChooserWidthPx(footerWidthPx: number) {
    this.formatChooserWidthPx = footerWidthPx;
  }

  private get formats() {
    return this.args.formats ?? formats;
  }

  get footerButtonsClass() {
    if (this.formatChooserWidthPx < 380) {
      // Adjust this as needed - it's where the buttons in single line start to get too squished
      return 'collapsed';
    }
    return null;
  }
}

interface ResizeSignature {
  Args: {
    Named: {
      setFormatChooserWidthPx: (formatChooserWidthPx: number) => void;
    };
  };
}

class ResizeModifier extends Modifier<ResizeSignature> {
  modify(
    element: HTMLElement,
    _positional: [],
    { setFormatChooserWidthPx }: ResizeSignature['Args']['Named'],
  ) {
    let resizeObserver = new ResizeObserver(() => {
      // setTimeout prevents the "ResizeObserver loop completed with undelivered notifications" error that happens in tests
      setTimeout(() => {
        setFormatChooserWidthPx(element.clientWidth);
      }, 1);
    });

    resizeObserver.observe(element);

    registerDestructor(this, () => {
      resizeObserver.disconnect();
    });
  }
}
