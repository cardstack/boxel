import {
  CardDef,
  linksTo,
  contains,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';
import { field, linksToMany } from 'https://cardstack.com/base/card-api';
import { Address as AddressField } from '../address';
import { Company } from './company';
import { Contact } from './contact';
import SummaryCard from '../components/summary-card';
import SummaryGridContainer from '../components/summary-grid-container';
import BuildingIcon from '@cardstack/boxel-icons/captions';
import AccountHeader from '../components/account-header';

class IsolatedTemplate extends Component<typeof Account> {
  //Mock Data:
  get logoURL() {
    return 'https://picsum.photos/id/237/200/300';
  }

  get companyName() {
    return 'TechNova Solutions';
  }

  <template>
    <AccountPageLayout>
      <:header>
        <AccountHeader @logoURL={{this.logoURL}} @name={{this.companyName}}>
          <:name>
            <h1 class='account-name'>{{this.companyName}}</h1>
          </:name>
          <:content>
            <p class='description'>Description</p>
          </:content>
        </AccountHeader>
      </:header>

      <:summary>
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
      </:summary>

      <:activities>
        <h2 class='activities-title'>Activities</h2>
      </:activities>
    </AccountPageLayout>

    <style scoped>
      .account-name {
        font: 600 var(--boxel-font-lg);
        margin: 0;
      }
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
  static displayName = 'CRM Account';

  @field company = linksTo(Company);
  @field primaryContact = linksTo(Contact);
  @field contacts = linksToMany(Contact);
  @field shippingAddress = contains(AddressField);
  @field billingAddress = contains(AddressField);
  @field website = contains(AddressField);

  static isolated = IsolatedTemplate;
}

interface AccountPageLayoutArgs {
  Blocks: {
    header: [];
    summary: [];
    activities: [];
  };
  Element: HTMLElement;
}

class AccountPageLayout extends GlimmerComponent<AccountPageLayoutArgs> {
  <template>
    <div class='account-page-layout' ...attributes>
      {{yield to='header'}}
      {{yield to='summary'}}
      {{yield to='activities'}}
    </div>

    <style scoped>
      .account-page-layout {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        width: 100%;
        padding: 20px;
        box-sizing: border-box;
      }
    </style>
  </template>
}
