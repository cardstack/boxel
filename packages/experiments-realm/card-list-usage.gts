import { CardDef, Component } from 'https://cardstack.com/base/card-api';
import CardList from './components/prerendered-search-card-list';

export default class CardListUsage extends CardDef {
  static displayName = 'Card List Usage';

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardList
        @model={{@model}}
        @context={{@context}}
        @cardDisplayName='Plant Info'
        @format='fitted/single-strip'
      />
    </template>
  };
}
