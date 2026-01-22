import { CardsGrid } from './cards-grid';
import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  realmInfo,
  StringField,
} from './card-api';

export class IndexCard extends CardDef {
  static displayName = 'Index';
  static prefersWideFormat = true;

  @field realmName = contains(StringField, {
    computeVia: function (this: IndexCard) {
      return this[realmInfo]?.name;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: IndexCard) {
      return this.realmName;
    },
  });
  @field cardsGrid = linksTo(CardsGrid);
  @field interactHome = linksTo(CardDef);
  @field hostHome = linksTo(CardDef);

  static isolated = class Isolated extends Component<typeof IndexCard> {
    private get prefersInteractHome() {
      let submode = this.args.context?.submode;
      return !!(
        (submode === 'interact' || submode === 'code') &&
        this.args.model.interactHome
      );
    }

    private get prefersHostHome() {
      let mode = this.args.context?.mode;
      let submode = this.args.context?.submode;
      return !!(
        (mode === 'host' || submode === 'host') &&
        this.args.model.hostHome
      );
    }

    <template>
      <div class='home'>
        {{#if this.prefersInteractHome}}
          <@fields.interactHome @format='isolated' />
        {{else if this.prefersHostHome}}
          <@fields.hostHome @format='isolated' />
        {{else if @model.cardsGrid}}
          <@fields.cardsGrid @format='isolated' />
        {{else}}
          <div data-test-empty-field class='empty-field'></div>
        {{/if}}
      </div>
      <style scoped>
        .home {
          height: 100%;
          width: 100%;
        }
        .home :deep(.field-component-card.isolated-format) {
          overflow: auto;
        }
        .home :deep(.boxel-card-container) {
          border-radius: 0;
        }
      </style>
    </template>
  };
}
