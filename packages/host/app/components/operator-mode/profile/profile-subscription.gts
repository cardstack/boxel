import { fn } from '@ember/helper';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { BoxelButton, FieldContainer } from '@cardstack/boxel-ui/components';
import { IconHexagon } from '@cardstack/boxel-ui/icons';

import WithSubscriptionData from '@cardstack/host/components/with-subscription-data';
import type BillingService from '@cardstack/host/services/billing-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type NetworkService from '@cardstack/host/services/network';

import type RealmServerService from '@cardstack/host/services/realm-server';

interface Signature {
  Args: {};
  Element: HTMLElement;
}

export default class ProfileSubscription extends Component<Signature> {
  @service declare private billingService: BillingService;
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private realmServer: RealmServerService;

  @action handleBuyMoreCredits(amount: number) {
    this.billingService.redirectToStripe({ aiCreditAmount: amount });
  }

  <template>
    <WithSubscriptionData as |subscriptionData|>
      <FieldContainer
        class='profile-field membership-tier-field'
        @label='Membership Tier'
      >
        <div class='profile-subscription membership-tier-content'>
          <div class='monthly-credit'>
            <div class='plan-name'>{{subscriptionData.plan}}</div>
            <div class='credit-info'>
              <span class='credit-info__label'>Monthly Credit</span>
              {{subscriptionData.monthlyCredit}}
            </div>
          </div>
          {{#if this.billingService.subscriptionData.plan}}
            <BoxelButton
              class='membership-tier-button'
              @kind='secondary-light'
              @size='extra-small'
              {{on
                'click'
                (fn
                  this.billingService.redirectToStripe
                  (hash plan=this.billingService.subscriptionData.plan)
                )
              }}
              data-test-manage-plan-button
            >Manage Plan</BoxelButton>
          {{/if}}
        </div>
      </FieldContainer>
      <FieldContainer @label='Additional Credit' class='profile-field'>
        <div class='additional-credit'>
          <div class='profile-subscription'>
            <div class='credit-info'>
              {{subscriptionData.additionalCredit}}
            </div>
          </div>
          <div class='buy-more-credits'>
            <span class='buy-more-credits__title'>Buy more credits</span>
            <div class='payment-links'>
              {{#each
                this.billingService.extraCreditsPricingFormatted
                as |extraCreditsPricing|
              }}
                <div class='payment-link'>
                  <span><IconHexagon width='16px' height='16px' />
                    {{extraCreditsPricing.amountFormatted}}
                  </span>

                  <BoxelButton
                    @kind='secondary-light'
                    @size='extra-small'
                    data-test-buy-more-credits-button={{extraCreditsPricing.amount}}
                    {{on
                      'click'
                      (fn this.handleBuyMoreCredits extraCreditsPricing.amount)
                    }}
                  >Buy</BoxelButton>
                </div>
              {{/each}}
            </div>
          </div>
        </div>
      </FieldContainer>
    </WithSubscriptionData>

    <style scoped>
      .profile-field :deep(.invalid) {
        box-shadow: none;
      }
      .profile-subscription {
        display: flex;
        justify-content: space-between;
      }
      .monthly-credit {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .credit-info {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: var(--boxel-sp-xs);
        padding-left: var(--boxel-sp-sm);
        border-left: 5px solid #c6c6c6;
        min-height: 40px;
      }
      .credit-info__label {
        font: var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
        text-wrap: nowrap;
        line-height: 18px;
      }
      .additional-credit {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .buy-more-credits {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        border-top: 1px solid var(--boxel-300);
        padding-top: var(--boxel-sp-sm);
      }
      .buy-more-credits__title {
        font: 600 var(--boxel-font-sm);
      }
      .payment-links {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding-left: var(--boxel-sp-xs);
      }
      .payment-link {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--boxel-sp-2xs);
      }
      .payment-link:not(:last-child) {
        border-bottom: 1px solid var(--boxel-200);
      }
      .payment-link > span {
        color: var(--boxel-dark);
        font: 600 var(--boxel-font-sm);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-3xs);

        --icon-color: var(--boxel-highlight);
        --boxel-loading-indicator-size: var(--boxel-icon-xs);
      }
      :deep(.buy-more-credits .boxel-loading-indicator) {
        width: 100%;
        text-align: center;
      }

      @container dialog-box (width <= 48rem) {
        .profile-field {
          grid-template-columns: 1fr;
          gap: var(--boxel-sp-xs);
        }
        .payment-links {
          padding-left: 0;
        }
        .payment-link {
          padding-inline: 0;
        }
        .membership-tier-field {
          position: relative;
        }
        .membership-tier-button {
          position: absolute;
          right: 0;
          top: var(--boxel-sp-2xs);
        }
        .membership-tier-content,
        .additional-credit {
          background-color: var(--boxel-100);
          padding: var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius);
        }
      }
    </style>
  </template>
}
