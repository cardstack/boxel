import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';
import { cn, eq, or } from '@cardstack/boxel-ui/helpers';

import type { Format } from '@cardstack/runtime-common';

import { formatsWithIcons, type FormatWithIcon } from '../card-formats';

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
        {{#each this.formats as |f|}}
          {{#if (or (eq f.format 'metadata') (eq f.format 'edit'))}}
            <span class='format-chooser__divider'></span>
          {{/if}}
          <Button
            @size='auto'
            class={{cn 'format-chooser__button' active=(eq @format f.format)}}
            {{on 'click' (fn @setFormat f.format)}}
            data-test-format-chooser={{f.format}}
          >
            {{#if f.icon}}
              <f.icon class='format-icon' />
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
        overflow: hidden;
      }

      .format-chooser__buttons {
        display: flex;
        width: 100%;
        border: 0;
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-deep-box-shadow);
        padding: var(--boxel-sp-2xs);
        gap: var(--boxel-sp-3xs);
      }

      .format-chooser__button {
        --boxel-button-color: transparent;
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-text-color: var(--boxel-light);
        opacity: 0.55;
        min-width: calc(var(--boxel-button-sm) - 2px);
        height: calc(var(--boxel-button-sm) - 2px);
        padding-inline: var(--boxel-sp-2xs);
        border-color: transparent;
        border-radius: var(--boxel-border-radius-2xl);
        text-transform: capitalize;
        gap: 0;
        transition: none;
      }

      .format-chooser__button:hover {
        --boxel-button-text-color: var(--boxel-highlight);
        border-color: currentColor;
        opacity: 1;
      }
      .format-chooser__button.active {
        --boxel-button-text-color: var(--boxel-highlight);
        opacity: 1;
      }

      .format-chooser__divider {
        width: 1px;
        align-self: stretch;
        margin: var(--boxel-sp-3xs);
        background-color: var(--boxel-500);
      }

      .format-icon {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
      }

      .format-name {
        display: inline-block;
        max-width: 0;
        overflow: hidden;
        white-space: nowrap;
        opacity: 0;
        will-change: max-width;
        transition: max-width 320ms cubic-bezier(0.4, 0, 0.2, 1);
      }

      .format-chooser__button:hover .format-name {
        margin-left: var(--boxel-sp-3xs);
        max-width: 6rem;
        opacity: 1;
      }
    </style>
  </template>

  private get formats() {
    return this.args.formatsWithIcons ?? formatsWithIcons;
  }
}
