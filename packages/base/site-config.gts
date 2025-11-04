import { CardDef, Component, field, linksTo } from './card-api';

// Site level configuration card. Additional routing fields can be added over time.
export class SiteConfig extends CardDef {
  static displayName = 'Site Configuration';

  @field home = linksTo(CardDef);

  static isolated = class Isolated extends Component<typeof SiteConfig> {
    <template>
      <div data-test-site-config-home>
        <@fields.home />
      </div>
    </template>
  };
}
