import { fn } from '@ember/helper';

import { on } from '@ember/modifier';
import Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask, task } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';
import window from 'ember-window-mock';

import {
  BoxelButton,
  FieldContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { or } from '@cardstack/boxel-ui/helpers';
import { IconHexagon } from '@cardstack/boxel-ui/icons';

import WithSubscriptionData from '@cardstack/host/components/with-subscription-data';
import BillingService from '@cardstack/host/services/billing-service';

interface Signature {
  Args: {};
  Element: HTMLElement;
}

export default class ProfileSubscription extends Component<Signature> {
  <template>
    <WithSubscriptionData as |subscriptionData|>
      <FieldContainer
        @label='Membership Tier'
        @tag='label'
        class='profile-field'
      >
        <div class='profile-subscription'>
          <div class='monthly-credit'>
            <div class='plan-name'>{{subscriptionData.plan}}</div>
            <div class='credit-info'>
              <span class='credit-info__label'>Monthly Credit</span>
              {{subscriptionData.monthlyCredit}}
            </div>
          </div>
          <BoxelButton
            @kind='secondary-light'
            @size='extra-small'
            @disabled={{or
              subscriptionData.isLoading
              this.fetchStripeLinks.isRunning
              this.managePlan.isRunning
            }}
            {{on 'click' (perform this.managePlan)}}
            data-test-manage-plan-button
          >Manage Plan</BoxelButton>
        </div>
      </FieldContainer>
      <FieldContainer
        @label='Additional Credit'
        @tag='label'
        class='profile-field'
      >
        <div class='additional-credit'>
          <div class='profile-subscription'>
            <div class='credit-info'>
              {{subscriptionData.additionalCredit}}
            </div>
          </div>
          <div class='buy-more-credits'>
            <span class='buy-more-credits__title'>Buy more credits</span>
            <div class='payment-links'>
              {{#if this.fetchStripeLinks.isRunning}}
                <LoadingIndicator />
              {{else}}
                {{#each
                  this.additionalCreditsPaymentLinks
                  as |paymentLink index|
                }}
                  <div class='payment-link' data-test-payment-link={{index}}>
                    <span><IconHexagon width='16px' height='16px' />
                      {{paymentLink.creditReloadAmount}}</span>
                    <BoxelButton
                      @kind='secondary-light'
                      @size='extra-small'
                      {{on 'click' (fn this.pay paymentLink.url)}}
                      data-test-pay-button={{index}}
                    >Pay</BoxelButton>
                  </div>
                {{/each}}
              {{/if}}
            </div>
          </div>
        </div>
      </FieldContainer>
    </WithSubscriptionData>
    <style scoped>
      .profile-field :deep(.invalid) {
        box-shadow: none;
      }
      .profile-field + .profile-field {
        margin-top: var(--boxel-sp-xl);
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
        border-bottom: 1px solid var(--boxel-300);
        padding: var(--boxel-sp-xxs);
      }
      .payment-link > span {
        color: var(--boxel-dark);
        font: 600 var(--boxel-font-sm);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);

        --icon-color: var(--boxel-teal);
        --boxel-loading-indicator-size: var(--boxel-icon-xs);
      }
      :deep(.buy-more-credits .boxel-loading-indicator) {
        width: 100%;
        text-align: center;
      }
    </style>
  </template>

  @service private declare billingService: BillingService;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.fetchStripeLinks.perform();
  }

  private fetchStripeLinks = task(async () => {
    await this.billingService.fetchStripeLinks();
  });

  private get additionalCreditsPaymentLinks() {
    return this.billingService.stripeLinks
      ?.filter((link) => link.creditReloadAmount)
      .sort(
        (linkA, linkB) => linkA.creditReloadAmount! - linkB.creditReloadAmount!,
      );
  }

  private pay(paymentLinkURL: string) {
    window.open(paymentLinkURL);
  }

  private managePlan = restartableTask(async () => {
    await this.billingService.managePlan();
  });
}
