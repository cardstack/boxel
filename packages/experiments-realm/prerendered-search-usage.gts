import { CardDef, Component } from 'https://cardstack.com/base/card-api';
import PrerenderedSearch from './components/prerendered-search';

export default class PrerenderedSearchUsage extends CardDef {
  static displayName = 'Prerendered Search Usage';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <PrerenderedSearch
        @model={{@model}}
        @context={{@context}}
        @cardTypeDisplayName='Plant Info'
        @format='fitted/single-strip'
        @fittedDisplayOption='grid'
        @hideOverlay={{true}}
        @hideContainer={{false}}
      />
    </template>
  };
}
