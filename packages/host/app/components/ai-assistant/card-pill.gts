import Component from '@glimmer/component';

import Pill from '@cardstack/host/components/pill';

import { type CardDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: { card: CardDef };
  Blocks: { default: [] };
}

export default class AiAssistantCardPill extends Component<Signature> {
  <template>
    <Pill @inert={{true}} class='card-pill' ...attributes>
      <div class='card-title'>{{getDisplayTitle @card}}</div>
      {{yield}}
    </Pill>

    <style>
      .card-pill {
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-400);
        height: var(--pill-height, 1.875rem);
      }
      .card-title {
        max-width: var(--pill-content-max-width, 10rem);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </template>
}

function getDisplayTitle(card: CardDef) {
  return card.title || card.constructor.displayName || 'Untitled Card';
}
