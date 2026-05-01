import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import {
  // formats,
  formatsWithIcons,
  type Format,
  type FormatWithIcon,
} from '@cardstack/runtime-common';

interface Signature {
  Args: {
    format: Format;
    setFormat: (format: Format) => void;
    additionalClass?: string;
    formats?: Format[];
    formatsWithIcons?: FormatWithIcon[];
  };
  Element: HTMLElement;
}

export default class FormatChooser extends Component<Signature> {
  <template>
    <div class='format-chooser' ...attributes>
      <div class='format-chooser__buttons'>
        {{#each this.formatsWithIcons as |f|}}
          {{#if (eq f.format 'metadata')}}
            <span class='format-chooser__divider'></span>
          {{/if}}
          <Button
            class={{cn 'format-chooser__button' active=(eq @format f.format)}}
            {{on 'click' (fn @setFormat f.format)}}
            data-test-format-chooser={{f.format}}
          >
            {{#if f.icon}}
              <f.icon />
              <span class='format-name'>{{f.format}}</span>
            {{else}}
              {{f.format}}
            {{/if}}
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

      .format-chooser__divider {
        width: 1px;
        align-self: stretch;
        margin: var(--boxel-sp-3xs);
        background-color: var(--boxel-400);
      }

      .format-name {
        display: none;
      }

      .format-chooser__button:hover .format-name,
      .format-chooser__button.active .format-name {
        display: inline-block;
      }
    </style>
  </template>

  // private get formats() {
  //   return this.args.formats ?? formats;
  // }

  private get formatsWithIcons() {
    return this.args.formatsWithIcons ?? formatsWithIcons;
  }
}
