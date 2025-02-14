import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { provide } from 'ember-provide-consume-context';

import { cn } from '@cardstack/boxel-ui/helpers';

import { DefaultFormatsContextName } from '@cardstack/runtime-common';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: BaseDef;
    isDarkMode?: boolean;
  };
}

const fittedFormats = [
  {
    name: 'Badges',
    specs: [
      {
        title: 'Small Badge',
        width: 150,
        height: 40,
      },
      {
        title: 'Medium Badge',
        width: 150,
        height: 65,
      },
      {
        title: 'Large Badge',
        width: 150,
        height: 105,
      },
    ],
  },
  {
    name: 'Strips',
    specs: [
      {
        title: 'Single Strip',
        width: 250,
        height: 40,
      },
      {
        title: 'Double Strip',
        width: 250,
        height: 65,
      },
      {
        title: 'Triple Strip',
        width: 250,
        height: 105,
      },
      {
        title: 'Double Wide Strip',
        width: 400,
        height: 65,
      },
      {
        title: 'Triple Wide Strip',
        width: 400,
        height: 105,
      },
    ],
  },
  {
    name: 'Tiles',
    specs: [
      {
        title: 'Small Tile',
        width: 150,
        height: 170,
      },
      {
        title: 'Regular Tile',
        width: 250,
        height: 170,
      },
      {
        title: 'CardsGrid Tile',
        width: 170,
        height: 250,
      },
      {
        title: 'Tall Tile',
        width: 150,
        height: 275,
      },
      {
        title: 'Large Tile',
        width: 250,
        height: 275,
      },
    ],
  },
  {
    name: 'Cards',
    specs: [
      {
        title: 'Compact Card',
        width: 400,
        height: 170,
      },
      {
        title: 'Full Card',
        width: 400,
        height: 275,
      },
      {
        title: 'Expanded Card',
        width: 400,
        height: 445,
      },
    ],
  },
];

const setContainerSize = ({
  width,
  height,
}: {
  width: number;
  height: number;
}) => {
  return htmlSafe(`width: ${width}px; height: ${height}px`);
};

export default class FittedFormatGallery extends Component<Signature> {
  @provide(DefaultFormatsContextName)
  get defaultFormat() {
    return { cardDef: 'fitted', fieldDef: 'fitted' };
  }

  @cached
  get renderedCard() {
    return this.args.card.constructor.getComponent(this.args.card);
  }

  <template>
    <div class={{cn 'fitted-format-gallery' dark-mode=@isDarkMode}}>
      {{#each fittedFormats as |format|}}
        <section class='format-section'>
          <h3 class='format-name'>{{format.name}}</h3>
          <ul class='specs'>
            {{#each format.specs as |spec|}}
              <li>
                <div class='spec-title'>
                  {{spec.title}}
                  -
                  {{spec.width}}x{{spec.height}}
                </div>
                <this.renderedCard
                  class='item'
                  @displayContainer={{true}}
                  style={{setContainerSize spec}}
                />
              </li>
            {{/each}}
          </ul>
        </section>
      {{/each}}
    </div>
    <style scoped>
      .fitted-format-gallery {
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
      .specs {
        margin-block: 0;
        padding-inline: 0;
        list-style-type: none;
      }
      .specs > li + li {
        margin-top: var(--boxel-sp-lg);
      }
      .spec-title {
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
        opacity: 70%;
      }
      .spec-title + .item {
        margin-top: var(--boxel-sp-xs);
      }
      .item {
        color: initial;
      }

      /* Dark mode */
      .dark-mode {
        --background-color: rgba(255 255 255 / 30%);
        --color: var(--boxel-light);
      }
    </style>
  </template>
}
