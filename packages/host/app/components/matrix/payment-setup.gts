import { service } from '@ember/service';
import Component from '@glimmer/component';

import InfoCircleIcon from '@cardstack/boxel-icons/info-circle';

import {
  BoxelButton,
  BoxelHeader,
  CardContainer,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  SuccessBordered,
  IconHexagon,
  BoxelIcon,
  IconPlus,
  Lock,
} from '@cardstack/boxel-ui/icons';

import type BillingService from '@cardstack/host/services/billing-service';

interface Signature {
  Args: {
    flow: 'register' | 'logged-in';
    matrixUserId: string;
  };
}

export default class PaymentSetup extends Component<Signature> {
  @service declare billingService: BillingService;

  get stripePaymentLink() {
    return this.billingService.getStripePaymentLink(this.args.matrixUserId);
  }

  <template>
    <div class='payment-setup'>
      <div class='container'>
        <CardContainer class='payment-setup-container'>
          <BoxelHeader
            @title='Boxel'
            @displayBorder={{true}}
            @hasBackground={{false}}
            class='header'
          >
            <:icon>
              <BoxelIcon />
            </:icon>
          </BoxelHeader>

          {{#if (eq @flow 'register')}}
            <div class='success-banner' data-test-email-validated>
              <SuccessBordered class='check-icon' />
              Success! Your email has been validated
            </div>
          {{else}}
            <div class='success-banner' data-test-setup-payment>
              <InfoCircleIcon class='info-icon' />
              Setup your payment method now to enjoy Boxel
            </div>
          {{/if}}

          <div class='offer-section'>
            <h2>EARLY ACCESS OFFER</h2>

            <p class='offer-title'>
              Claim
              <span class='credit-icon'><IconHexagon
                  class='credit-icon-svg'
                  width='24px'
                  height='24px'
                />
                1000</span>
              Boxel Credits a month by setting up a payment method.
            </p>

            <div class='credit-icon-container'>
              <span class='boxel-icon'><BoxelIcon
                  width='50px'
                  height='50px'
                /></span>
              <span class='plus'><IconPlus width='16px' height='16px' /></span>
              <span class='boxel-credits-icon'><IconHexagon
                  width='50px'
                  height='50px'
                /></span>
            </div>

            <div class='benefits-container'>
              <ul class='benefits-list'>
                <li>To use Boxel you need Boxel Credits for platform & AI access</li>
                <li>You can top up your credit if you run out</li>
                <li>You won't be charged anything to try Boxel</li>
              </ul>
            </div>

            <BoxelButton
              @as='anchor'
              @kind='primary'
              @href={{this.stripePaymentLink}}
              data-test-setup-payment
              class='setup-button'
            >
              Set up Secure Payment Method
              <span class='lock-icon'><Lock
                  width='16cpx'
                  height='16px'
                /></span>
            </BoxelButton>

            <p class='payment-note'>
              We currently support credit card as the payment method, additional
              payment method using web 3 wallet coming soon
            </p>
          </div>
        </CardContainer>
      </div>
    </div>

    <style scoped>
      .payment-setup {
        height: 100%;
        overflow: auto;
      }

      .container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100%;
        padding: var(--boxel-sp-lg);
      }

      .payment-setup-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 550px;
        background-color: transparent;
      }

      .header {
        --boxel-header-padding: var(--boxel-sp);
        --boxel-header-text-font: var(--boxel-font);

        color: var(--boxel-light);
        text-transform: uppercase;
        max-width: max-content;
        min-width: 100%;
        gap: var(--boxel-sp-xxs);
        letter-spacing: var(--boxel-lsp-lg);
      }

      .success-banner {
        width: 100%;
        background: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xxl);
        padding: var(--boxel-sp-lg);
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        font-weight: 500;
      }

      .check-icon {
        --icon-fill: var(--boxel-teal);
      }

      .offer-section {
        background: white;
        border-radius: var(--boxel-border-radius-xxl);
        text-align: center;
        padding: var(--boxel-sp-xl);
      }

      h2 {
        font-size: var(--boxel-font-sm);
        color: #646464;
        font-weight: 600;
        margin-bottom: var(--boxel-sp);
      }

      .offer-title {
        padding: 0 var(--boxel-sp-lg);
        font-size: var(--boxel-font-size-lg);
        font-weight: 600;
        margin-top: 0;
        margin-bottom: 30px;
      }
      .offer-title .credit-icon {
        font-size: var(--boxel-font-sm);
        --icon-color: var(--boxel-teal);
        position: relative;
      }
      .offer-title .credit-icon-svg {
        transform: translateY(3px);
      }

      .credit-amount {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        color: var(--boxel-purple);
      }

      .credit-icon-container {
        width: fit-content;
        background-color: var(--boxel-dark);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
        border-radius: 40px;
        margin: 0 auto var(--boxel-sp-xl);
      }
      .plus {
        --icon-color: var(--boxel-teal);
      }
      .boxel-credits-icon {
        --icon-color: var(--boxel-teal);
      }

      .benefits-container {
        padding: 0 var(--boxel-sp-xxxl);
        margin-bottom: var(--boxel-sp-xl);
      }
      .benefits-list {
        padding: 0;
        padding-left: var(--boxel-sp);
        margin: 0;
        text-align: left;
      }
      .benefits-list li {
        margin: var(--boxel-sp-sm) 0;
        font-weight: 500;
        color: var(--boxel-dark);
        position: relative;
      }

      .setup-button {
        width: 100%;
        margin-bottom: var(--boxel-sp-lg);
        padding: var(--boxel-sp);
      }
      .lock-icon {
        margin-left: var(--boxel-sp-sm);
      }

      .payment-note {
        font: var(--boxel-font-xs);
        color: #6f6f6f;
        margin: 0;
      }
    </style>
  </template>
}
