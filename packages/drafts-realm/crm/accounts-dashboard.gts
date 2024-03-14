import StringCard from 'https://cardstack.com/base/string';
import {
  Component,
  CardDef,
  field,
  contains,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { GridContainer } from '@cardstack/boxel-ui/components';
import { CrmAccount } from './account';

class AccountsDashboardIsolated extends Component<typeof AccountsDashboard> {
  get getAccounts() {
    let allAccounts = this.args.model.accounts || [];
    return allAccounts;
  }

  get getAccountsNames() {
    let allAccounts = this.args.model.accounts || [];
    return allAccounts.map((o) => o.accountName);
  }
  <template>
    <div>
      <div class='header-container'>
        Accounts Dashboard
      </div>
      <div class='cart-container'>

        <div class='line-items-header'>
          <div class='cell'>
            Product
          </div>
          <div class='cell quantity-cell'>
            Qty
          </div>
          <div class='cell price-cell'>
            Unit Price
          </div>
          <div class='cell price-cell'>
            Total
          </div>
        </div>

        {{#each this.getAccounts as |account|}}
          <h1>hi</h1>
          {{account.owner}}
        {{/each}}
        {{#each this.getAccountsNames as |names|}}
          {{names}}
        {{/each}}
        <@fields.accounts @format='embedded' />
        <div class='cell total-container'>
        </div>
      </div>
    </div>
    <style>
      .header-container {
        background-image: url(https://i.imgur.com/PQuDAEo.jpg);
        color: white;
        font: var(--boxel-font-lg);
        font-weight: bold;
        padding: var(--boxel-sp);
      }
      .preferred-currency-container {
        color: white;
        float: right;
        font: var(--boxel-font-sm);
        margin-top: -8px;
        text-align: right;
      }
      .preferred-currency-container > div {
        color: black;
      }
      .cart-container {
        padding: var(--boxel-sp);
      }
      .line-items-header {
        display: grid;
        grid-template-columns: 1fr 60px 120px 120px;
        font-weight: bold;
      }
      .cell {
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm) var(--boxel-sp-xs) 0;
      }
      .quantity-cell {
        text-align: center;
      }
      .price-cell {
        text-align: right;
      }
      .total-container {
        font-weight: bold;
        text-align: right;
      }
    </style>
  </template>
}

export class AccountsDashboard extends CardDef {
  static displayName = 'Accounts Dashboard';
  @field title = contains(StringCard, {
    computeVia: function (this: AccountsDashboard) {
      return 'Crm Accounts Dashboard';
    },
  });

  @field accounts = linksToMany(() => CrmAccount);

  static isolated = AccountsDashboardIsolated;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer>
        Wth
      </GridContainer>
    </template>
  };
}
