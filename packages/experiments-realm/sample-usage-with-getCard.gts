import {
  contains,
  field,
  Component,
  CardDef,
  BaseDef,
} from 'https://cardstack.com/base/card-api';
import { getCard } from '@cardstack/runtime-common';
import StringCard from 'https://cardstack.com/base/string';

export class SampleUsageWithGetCard extends CardDef {
  static displayName = 'SampleUsageWithGetCard';
  @field name = contains(StringCard);
  @field title = contains(StringCard, {
    computeVia: function (this: SampleUsageWithGetCard) {
      return this.name;
    },
  });

  static edit = class Edit extends Component<typeof SampleUsageWithGetCard> {
    get id() {
      return 'http://localhost:4201/experiments/SimpleCard/4b5961ee-c0f6-4952-bcb0-b924909739e2';
    }

    private resource = getCard<SampleUsageWithGetCard>(new URL(this.id));

    get card() {
      // console.log(this.resource.card?.name); <- this will cause a re-render
      return this.resource.card;
    }

    getComponent(cardOrField: BaseDef) {
      return cardOrField.constructor.getComponent(cardOrField);
    }

    <template>
      {{#if this.card}}
        {{#let (this.getComponent this.card) as |CardComponent|}}
          <CardComponent />
        {{/let}}
      {{else}}
        <div>
          Loading...
        </div>
      {{/if}}
    </template>
  };
}
