import { CardDef } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';
import SummaryCard from '../components/summary-card';
import SummaryGridContainer from '../components/summary-grid-container';
import BuildingIcon from '@cardstack/boxel-icons/captions';
import UserSquare from '@cardstack/boxel-icons/user-square';
import { BoxelButton, Pill } from '@cardstack/boxel-ui/components';
import Info from '@cardstack/boxel-icons/info';
import AccountHeader from '../components/account-header';
import CrmProgressBar from '../components/crm-progress-bar';
import { EntityDisplay } from '../components/entity-display';
import { htmlSafe } from '@ember/template';
import { concat } from '@ember/helper';

class IsolatedTemplate extends Component<typeof Deal> {
  //Mock Data:
  get logoURL() {
    return 'https://picsum.photos/id/500/200/300';
  }

  get companyName() {
    return 'TechNova Solutions';
  }

  get primaryContactwithPosition() {
    const contactName = 'Olivia';
    const contactPosition = 'Head of Partnerships';

    return `${contactName} - ${contactPosition}`;
  }

  get pillsData() {
    return [
      { label: 'Proposal', backgroundColor: 'var(--boxel-lilac)' },
      { label: 'High Priority', backgroundColor: 'var(--boxel-yellow)' },
    ];
  }

  <template>
    <DealPageLayout>
      <:header>
        <AccountHeader @logoURL={{this.logoURL}} @name={{this.companyName}}>
          <:name>
            <h1 class='account-name'>{{this.companyName}}</h1>
          </:name>
          <:content>
            <EntityDisplay
              @name={{this.primaryContactwithPosition}}
              @underline={{true}}
            >
              <:thumbnail>
                <UserSquare class='user-icon' width='20px' height='20px' />
              </:thumbnail>
            </EntityDisplay>

            <div class='tag-container'>
              {{#each this.pillsData as |pill|}}
                <Pill
                  style={{htmlSafe
                    (concat
                      'background-color: '
                      pill.backgroundColor
                      '; border-color: transparent;'
                    )
                  }}
                >{{pill.label}}</Pill>
              {{/each}}
            </div>
          </:content>
        </AccountHeader>
      </:header>

      <:dashboard>
        <SummaryCard class='dashboard'>
          <:title>
            <h2 class='summary-title'>Deal Value</h2>
          </:title>
          <:icon>
            <div class='progress-container'>
              <label class='progress-label'>85% Health Score</label>
              <CrmProgressBar
                @value={{85}}
                @max={{100}}
                @color='var(--boxel-green)'
              />
            </div>
          </:icon>
          <:content>
            <article class='dashboard-cards'>
              <div class='block'>
                <label>Current Value:</label>
                <span class='highlight-value'>$250,000</span>
                <p class='description success-value'>Description</p>
              </div>
              <div class='block'>
                <label>Predicted Revenue:</label>
                <span class='highlight-value'>$275,000</span>
                <p class='description secondary-value'>Description</p>
              </div>
              <div class='block'>
                <label>Profit Margin:</label>
                <span class='highlight-value'>22%</span>
                <p class='description secondary-value'>Description</p>
              </div>
            </article>

            <hr />

            <article class='value-breakdown'>
              <header>
                <label>Value Breakdown</label>
              </header>
              <table class='breakdown-table'>
                <tbody>
                  <tr>
                    <td class='item-name'>Venue Rental:</td>
                    <td class='item-value'>$100,000</td>
                  </tr>
                  <tr>
                    <td class='item-name'>Catering:</td>
                    <td class='item-value'>$75,000</td>
                  </tr>
                  <tr>
                    <td class='item-name'>AV Equipment:</td>
                    <td class='item-value'>$50,000</td>
                  </tr>
                  <tr>
                    <td class='item-name'>Staff and Management:</td>
                    <td class='item-value'>$25,000</td>
                  </tr>
                </tbody>
              </table>
            </article>

            <hr />

            <footer class='next-steps'>
              <div class='next-steps-row'>
                <EntityDisplay @name='Next Steps'>
                  <:thumbnail>
                    <Info class='info-icon' width='20px' height='20px' />
                  </:thumbnail>
                </EntityDisplay>

                <BoxelButton
                  @as='button'
                  @size='extra-small'
                  @kind='secondary-light'
                  class='view-proposal-btn'
                >
                  View Proposal
                </BoxelButton>
              </div>
              <p class='descriptio mt-5'>Finalize venue contract and confirm
                catering options to lock in current pricing.</p>
            </footer>

          </:content>
        </SummaryCard>
      </:dashboard>

      <:summary>
        <SummaryGridContainer>
          <SummaryCard>
            <:title>
              <label>Company Info</label>
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
              <label>Contacts</label>
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
              <label>Lifetime Value</label>
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
              <label>Active Deals</label>
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
    </DealPageLayout>

    <style scoped>
      h1,
      h2,
      h3,
      h4,
      p {
        margin: 0;
      }
      hr {
        border: 1px solid var(--boxel-200);
        margin: 1.3rem 0;
      }
      label {
        font-weight: 500;
      }
      .mt-5 {
        margin-top: 1rem;
      }
      .highlight-value {
        font: 600 var(--boxel-font-xl);
      }
      .secondary-value {
        font: 300 var(--boxel-font-sm);
        color: var(--boxel-400);
      }
      .success-value {
        font: 300 var(--boxel-font-sm);
        color: var(--boxel-dark-green);
      }
      .block {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxxs);
      }

      /* dashboard */
      .dashboard {
        container-type: inline-size;
      }
      .dashboard-cards {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: var(--boxel-sp-xl);
        margin-top: var(--boxel-sp);
      }
      .account-name {
        font: 600 var(--boxel-font-lg);
      }
      .user-icon {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        flex-shrink: 0;
        margin-left: auto;
      }
      .tag-container {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        margin-top: var(--boxel-sp-xxs);
      }
      .summary-title {
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xxs);
        align-self: flex-start;
      }
      .summary-highlight {
        font: 600 var(--boxel-font-lg);
      }
      .description {
        font: 300 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }

      /* Dashboard */
      .progress-container {
        display: flex;
        align-items: start;
        gap: var(--boxel-sp-xxs);
      }
      .progress-label {
        color: var(--boxel-500);
      }

      /* table */
      .breakdown-table {
        width: 90%;
        margin-left: auto;
        margin-right: 1rem;
        margin-top: 0.5rem;
      }
      .item-name,
      .item-value {
        padding: 8px;
        text-align: left;
      }
      .item-value {
        text-align: right;
        font-weight: 600;
      }
      /* footer */
      .next-steps-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .view-proposal-btn {
        font-weight: 600;
        padding: 2px 5px;
        min-width: 0px;
        min-height: 0px;
      }
      @container (max-width: 447px) {
        .progress-container {
          flex-direction: column-reverse;
          align-items: flex-end;
        }
        .dashboard-cards {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

export class Deal extends CardDef {
  static displayName = 'CRM Deal';

  static isolated = IsolatedTemplate;
}

interface DealPageLayoutArgs {
  Blocks: {
    header: [];
    dashboard: [];
    summary: [];
  };
  Element: HTMLElement;
}

class DealPageLayout extends GlimmerComponent<DealPageLayoutArgs> {
  <template>
    <div class='deal-page-layout' ...attributes>
      {{yield to='header'}}
      {{yield to='dashboard'}}
      {{yield to='summary'}}
    </div>

    <style scoped>
      .deal-page-layout {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        width: 100%;
        padding: var(--boxel-sp-lg);
        box-sizing: border-box;
      }
    </style>
  </template>
}
