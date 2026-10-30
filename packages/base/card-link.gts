import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { consume } from 'ember-provide-consume-context';

import {
  CardCrudFunctionsContextName,
  CurrentCardContextName,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import type { CardCrudFunctions, CardDef, Format } from './card-api';
import { getRelationshipMembershipState } from './field-support';

// A link from a card to another card. It renders a real anchor, so copy link,
// a new tab and crawlers get a real address, and a plain click opens the
// target the way the environment it is rendered in opens cards: a page
// navigation on a published site, a stack push in interact mode, the preview
// in code mode.
//
//   <CardLink @field='brand'>{{@model.brand.name}}</CardLink>
//   <CardLink @field='products' @index={{i}} @cover={{true}} />
//   <CardLink @id={{entry.id}}>{{entry.title}}</CardLink>
//   <CardLink @path='/journal'>Journal</CardLink>
//
// `@field` names a linked field of the card whose template the link is in,
// and reads the link without loading the linked card. Rendering a linked card
// stays with `<@fields.x />`; CardLink never renders one.

interface Signature {
  Element: HTMLAnchorElement;
  Args: {
    field?: string;
    index?: number;
    id?: string;
    path?: string;
    format?: Format;
    stack?: 'push' | 'rightmost';
    // Open the card over the page on a published site.
    overlay?: boolean;
    // Cover the nearest positioned ancestor: a whole tile that opens the card.
    // The block's content becomes the link's accessible name.
    cover?: boolean;
  };
  Blocks: { default: [] };
}

export class CardLink extends Component<Signature> {
  @consume(CurrentCardContextName) declare currentCard: CardDef | undefined;
  @consume(CardCrudFunctionsContextName)
  declare cardCrudFunctions: Partial<CardCrudFunctions> | undefined;

  get targetCard(): string | undefined {
    let { field, id, index } = this.args;
    if (id !== undefined) {
      if (typeof id !== 'string') {
        throw new Error(
          '<CardLink> @id takes a card URL. For a card the template holds as a field, pass the field name: <CardLink @field="name">.',
        );
      }
      return withoutJSON(id);
    }
    if (field === undefined) {
      return undefined;
    }
    if (typeof field !== 'string') {
      throw new Error(
        `<CardLink> @field takes the field's name, as in <CardLink @field="author">, not a field component or a card. For a card held only as data, use @id.`,
      );
    }
    let card = this.currentCard;
    if (!card) {
      return undefined;
    }
    let state = getRelationshipMembershipState(card, field);
    let reference = state.membership?.[index ?? 0]?.reference;
    if (!reference) {
      return undefined;
    }
    try {
      return withoutJSON(new URL(reference, card.id ?? undefined).href);
    } catch {
      return undefined;
    }
  }

  get href(): string | undefined {
    let { path } = this.args;
    let hrefFor = this.cardCrudFunctions?.hrefFor;
    if (path !== undefined) {
      return hrefFor?.({ path }) ?? path;
    }
    let card = this.targetCard;
    if (!card) {
      return undefined;
    }
    return hrefFor?.({ card }) ?? card;
  }

  private activate = (event: Event) => {
    if (!(event instanceof MouseEvent)) {
      return;
    }
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    let anchor = event.currentTarget as HTMLAnchorElement;
    if (anchor.target && anchor.target !== '_self') {
      return;
    }
    let crud = this.cardCrudFunctions;
    let { path, format, stack, overlay } = this.args;
    let card = this.targetCard;
    if (crud?.navigateTo && (card || path)) {
      event.preventDefault();
      // Whatever card or host tracking wraps the link must not also open it.
      event.stopPropagation();
      crud.navigateTo(card ? { card } : { path: path! }, {
        format,
        overlay,
      });
      return;
    }
    if (card && crud?.viewCard) {
      event.preventDefault();
      event.stopPropagation();
      crud.viewCard(card as RealmResourceIdentifier, format ?? 'isolated', {
        openCardInRightMostStack: stack === 'rightmost',
        overlay,
      });
    }
    // Otherwise the browser follows the link.
  };

  <template>
    <a
      href={{this.href}}
      class={{if @cover 'card-link card-link-cover' 'card-link'}}
      data-boxel-card-link={{if this.targetCard this.targetCard @path}}
      {{on 'click' this.activate}}
      ...attributes
    >
      {{#if @cover}}
        <span class='card-link-label'>{{yield}}</span>
      {{else}}
        {{yield}}
      {{/if}}
    </a>
    <style scoped>
      .card-link-cover {
        position: absolute;
        inset: 0;
        z-index: 1;
        border-radius: inherit;
      }
      .card-link-cover:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: 2px;
      }
      .card-link-label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    </style>
  </template>
}

function withoutJSON(url: string): string {
  return url.replace(/\.json$/, '');
}

export default CardLink;
