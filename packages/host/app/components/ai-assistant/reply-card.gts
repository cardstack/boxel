import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type { CardDef, FileDef, Format } from '@cardstack/base/card-api';

interface Signature {
  Args: {
    card: CardDef | FileDef;
    format: Format;
    heightless?: boolean;
  };
}

// A card or file a reply names in a sentence or shows in its own slot. The
// slot is the one rounded box, so the card meets its edge square; a card
// named in a sentence takes the pill's type and no surface of its own.
const ReplyCard: TemplateOnlyComponent<Signature> = <template>
  <CardRenderer
    class={{cn 'reply-card' inline=(eq @format 'atom') heightless=@heightless}}
    @card={{@card}}
    @format={{@format}}
    @displayContainer={{false}}
  />
  <style scoped>
    .reply-card {
      border-radius: 0;
    }
    /* a fitted card the reply gives no height is a size container, so
       its content cannot grow it: give it a tile's height rather than the
       40px strip that cuts it to one line */
    .reply-card.heightless {
      height: 5.5rem;
    }
    .reply-card.inline {
      min-width: 0;
      background: none;
      box-shadow: none;
      outline: 0;
      font: inherit;
      line-height: inherit;
      color: inherit;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  </style>
</template>;

export default ReplyCard;
