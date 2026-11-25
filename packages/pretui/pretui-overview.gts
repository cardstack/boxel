// Pretui — the showcase overview card: the showcase opened on its docs view,
// on one category. One instance per category (plus one for the whole kit)
// lets a Spec page's breadcrumb open it already filtered.
import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { ShowcaseApp } from './showcase-app';

class Isolated extends Component<typeof PretUIOverview> {
  <template>
    <ShowcaseApp
      @context={{@context}}
      @start='docs'
      @category={{@model.category}}
    />
  </template>
}

export class PretUIOverview extends CardDef {
  static displayName = 'Pret UI Components';
  static prefersWideFormat = true;
  /** the category this instance opens on; empty opens the whole kit */
  @field category = contains(StringField);
  static isolated = Isolated;
}
