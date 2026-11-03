import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { cn } from '@cardstack/boxel-ui/helpers';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type { SlotCardSignature } from '@cardstack/host/components/operator-mode/preview-panel/rendered-markdown';

// A card or file a reply names in a sentence or shows in its own slot. The
// slot is the one rounded box, so the card meets its edge square; a card
// named in a sentence takes the pill's type and no surface of its own.
const ReplyCard: TemplateOnlyComponent<SlotCardSignature> = <template>
  <CardRenderer
    class={{cn 'reply-card' inline=@inline heightless=@heightless}}
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
    /* an atom named in a sentence has no box of its own (display:
       contents), so only what inherits reaches its text: the pill's type,
       ink and one line. The pill's truncation is the reply's */
    .reply-card.inline {
      font: inherit;
      line-height: inherit;
      color: inherit;
      white-space: nowrap;
    }
  </style>
</template>;

export default ReplyCard;
