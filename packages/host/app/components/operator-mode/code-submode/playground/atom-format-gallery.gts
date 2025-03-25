import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { provide } from 'ember-provide-consume-context';

import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import { DefaultFormatsContextName } from '@cardstack/runtime-common';

import Preview from '@cardstack/host/components/preview';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: BaseDef;
    isDarkMode?: boolean;
    isFieldDef?: boolean;
  };
}

const atomFormats = [
  {
    name: 'No Icon',
    spec: 'no-icon',
  },
  {
    name: 'With profile icon',
    spec: 'profile-icon',
  },
  {
    name: 'Embedded email',
    spec: 'embedded-email',
  },
  {
    name: 'Embedded, no pill',
    spec: 'embedded-no-pill',
  },
  {
    name: 'In dropdown',
    spec: 'dropdown',
  },
  {
    name: 'In Field, with remove icon',
    spec: 'field-remove',
  },
  {
    name: 'Default color option',
    spec: 'default-color',
  },
  {
    name: 'Light color option',
    spec: 'light-color',
  },
  {
    name: 'Dark color option',
    spec: 'dark-color',
  },
];

export default class AtomFormatGallery extends Component<Signature> {
  @provide(DefaultFormatsContextName)
  get defaultFormat() {
    return { cardDef: 'atom', fieldDef: 'atom' };
  }

  @cached
  get renderedCard() {
    return this.args.card.constructor.getComponent(this.args.card);
  }

  get emptyArray() {
    return [];
  }

  emptyOnChange() {
    return;
  }

  <template>
    <div class={{cn 'atom-format-gallery' dark-mode=@isDarkMode}}>
      {{#each atomFormats as |format|}}
        <section class='format-section'>
          <h3 class='format-name'>{{format.name}}</h3>
          <div class='atom-preview-container {{format.spec}}'>
            {{#if (eq format.spec 'embedded-email')}}
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
              <Preview
                class='atom-preview'
                @card={{@card}}
                @format='atom'
                @displayContainer={{true}}
              />
              tempor incididunt ut labore et dolore magna aliqua.
            {{else if (eq format.spec 'embedded-no-pill')}}
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
              <Preview
                class='atom-preview'
                @card={{@card}}
                @format='atom'
                @displayContainer={{false}}
              />
              tempor incididunt ut labore et dolore magna aliqua.
            {{else if (eq format.spec 'dropdown')}}
              <BoxelSelect
                @selectedItemComponent={{component
                  Preview
                  card=@card
                  format='atom'
                  displayContainer=true
                }}
                @options={{this.emptyArray}}
                @onChange={{this.emptyOnChange}}
              />
            {{else}}
              <Preview
                class='atom-preview'
                @card={{@card}}
                @format='atom'
                @displayContainer={{true}}
              />
            {{/if}}
          </div>
        </section>
      {{/each}}
    </div>

    <style scoped>
      .atom-format-gallery {
        color: var(--color, var(--boxel-dark));
      }
      .format-section + .format-section {
        margin-top: var(--boxel-sp-xl);
      }
      .format-section > h3 + ul {
        margin-top: var(--boxel-sp-lg);
      }
      .format-name {
        margin: 0;
        padding: var(--boxel-sp-xs);
        background-color: var(--background-color, rgba(0 0 0 / 10%));
        border-radius: var(--boxel-border-radius-sm);
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .atom-preview-container {
        color: var(--boxel-dark);
        font: 500 var(--boxel-font-sm);
        line-height: 2.15;
        letter-spacing: 0.13px;
        margin-top: var(--boxel-sp-lg);
      }
      .atom-preview :deep(.atom-default-template) {
        color: var(--boxel-dark);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-4xs);
        background-color: var(--boxel-light);
        margin: 0 var(--boxel-sp-xxxs);
        font: 600 var(--boxel-font-xs);
        line-height: 1.27;
        letter-spacing: 0.17px;
      }

      /* Context-specific styles targeting atom component elements */
      .no-icon .atom-preview :deep(span img) {
        display: none;
      }

      .profile-icon .atom-preview :deep(span img) {
        border-radius: 50%;
      }

      .embedded-email,
      .embedded-no-pill {
        color: var(--boxel-light);
        padding: var(--boxel-sp-lg);
        line-height: 1.5;
      }

      .embedded-email .atom-preview :deep(span) {
        color: var(--boxel-dark);
      }

      .dropdown {
        width: 300px;
      }

      .field-remove .atom-preview :deep(span) {
        padding-right: var(--boxel-sp-xs);
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .field-remove .atom-preview :deep(span::after) {
        content: '×';
        margin-left: var(--boxel-sp-xs);
        color: var(--boxel-dark);
        font-size: var(--boxel-font-size);
      }

      /* Color variants */
      .default-color .atom-preview :deep(span) {
        background-color: var(--boxel-light);
      }

      .light-color .atom-preview {
        background-color: #f1ff83;
      }

      .dark-color .atom-preview {
        background-color: #2e0046;
        color: var(--boxel-light);
        box-shadow: none;
      }

      .dark-mode {
        --background-color: rgba(255 255 255 / 30%);
        --color: var(--boxel-light);
      }
    </style>
  </template>
}
