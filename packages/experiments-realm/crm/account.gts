import { CardDef, linksTo } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { field, linksToMany } from 'https://cardstack.com/base/card-api';
import { Company } from './company';
import { Contact } from './contact';
import { Deal } from './deal';
import SummaryCard from '../components/summary-card';
import SummaryGridContainer from '../components/summary-grid-container';
import BuildingIcon from '@cardstack/boxel-icons/captions';

class IsolatedTemplate extends Component<typeof Account> {
  <template>
    <SummaryGridContainer>
      <SummaryCard>
        <:title>
          <h3 class='summary-title'>Company Info</h3>
        </:title>
        <:icon>
          <BuildingIcon class='header-icon' />
        </:icon>
        <:content>
          <p class='description'>Description</p>
          <p class='description'>Description</p>
        </:content>
      </SummaryCard>

      <SummaryCard>
        <:title>
          <h3 class='summary-title'>Contacts</h3>
        </:title>
        <:icon>
          <BuildingIcon class='header-icon' />
        </:icon>
        <:content>
          <p class='description'>Description</p>
          <p class='description'>Description</p>
        </:content>
      </SummaryCard>

      <SummaryCard>
        <:title>
          <h3 class='summary-title'>Lifetime Value</h3>
        </:title>
        <:icon>
          <BuildingIcon class='header-icon' />
        </:icon>
        <:content>
          <h3 class='summary-highlight'>Desc</h3>
          <p class='description'>Desc</p>
        </:content>
      </SummaryCard>

      <SummaryCard>
        <:title>
          <h3 class='summary-title'>Active Deals</h3>
        </:title>
        <:icon>
          <BuildingIcon class='header-icon' />
        </:icon>
        <:content>
          <h3 class='summary-highlight'>Desc</h3>
          <p class='description'>Desc</p>
        </:content>
      </SummaryCard>
    </SummaryGridContainer>

    <style scoped>
      .summary-title {
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xxs);
        margin: 0;
      }
      .header-icon {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        flex-shrink: 0;
        margin-left: auto;
      }
      .summary-highlight {
        font: 600 var(--boxel-font-lg);
        margin: 0;
      }
      .description {
        margin: 0;
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
    </style>
  </template>
}

export class Account extends CardDef {
  static displayName = 'Account';

  @field company = linksTo(Company);
  @field primaryContact = linksTo(Contact);
  @field contacts = linksToMany(Contact);
  @field deals = linksToMany(Deal);

  static isolated = IsolatedTemplate;
}
