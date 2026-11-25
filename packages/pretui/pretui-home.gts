// Pretui — the showcase home card: the realm's index. It opens the showcase
// on its home view.
import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { ShowcaseApp } from './showcase-app';

class Isolated extends Component<typeof PretUIHome> {
  <template>
    <ShowcaseApp
      @context={{@context}}
      @start='home'
      @tagline={{@model.tagline}}
    />
  </template>
}

export class PretUIHome extends CardDef {
  static displayName = 'Pret UI';
  static prefersWideFormat = true;
  /** overrides the hero's one-line description of the kit */
  @field tagline = contains(StringField);
  static isolated = Isolated;
}
