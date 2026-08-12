import { fn } from '@ember/helper';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';

import { service } from '@ember/service';

import Component from '@glimmer/component';

import { IconHexagon } from '@cardstack/boxel-ui/icons';

import type BillingService from '@cardstack/host/services/billing-service';

import ModalContainer from '../modal-container';

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    isModalOpen: boolean;
    onClose: () => void;
  };
}

export default class ChooseSubscriptionPlanModal extends Component<Signature> {
  @service declare billingService: BillingService;

  get currentPlan() {
    return this.billingService.subscriptionData?.plan;
  }

  get isStarterPlan() {
    return this.currentPlan === 'Starter';
  }

  get isCreatorPlan() {
    return this.currentPlan === 'Creator';
  }

  get isPowerUserPlan() {
    return this.currentPlan === 'Power User';
  }

  <template>
    <style scoped>
      :global(.choose-subscription-plan-modal .dialog-box__content) {
        scroll-snap-type: y mandatory;
        scroll-padding-top: 50px;
        grid-row: 1 / -1;
      }
      :global(.choose-subscription-plan-modal .dialog-box__header) {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2;
        background: transparent;
        pointer-events: none;
      }
      :global(.choose-subscription-plan-modal .dialog-box__close) {
        pointer-events: auto;
      }

      .boxel-pricing-container {
        color: var(--boxel-700);
        background-color: var(--boxel-light);
        max-width: var(--boxel-xxl-container);
        margin: 0 auto;
        padding-top: 50px;
      }

      .main-title,
      .early-preview-banner,
      .intro-text,
      .subscription-header,
      .pricing-table,
      .footer-notes {
        scroll-snap-align: start;
      }

      .main-title {
        font: var(--boxel-font-xl);
        font-weight: 700;
        text-align: center;
        color: var(--boxel-dark);
        margin-bottom: var(--boxel-sp-lg);
        margin-top: 0;
      }

      .early-preview-banner {
        background-color: var(--boxel-lime);
        border-radius: var(--boxel-border-radius-sm);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        font: var(--boxel-font);
        font-weight: 500;
        text-align: center;
        width: fit-content;
        margin: 0 auto var(--boxel-sp) auto;
      }

      .intro-text {
        text-align: center;
        max-width: var(--boxel-xl-container);
        margin: 0 auto var(--boxel-sp-xxl) auto;
        font: var(--boxel-font);
        line-height: 1.5;
        color: var(--boxel-700);
      }

      .subscription-header {
        text-align: center;
        margin-bottom: var(--boxel-sp-lg);
      }

      .subscription-title {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-sm);
        margin-bottom: var(--boxel-sp-xs);
      }

      .subscription-title h2 {
        font: var(--boxel-font-lg);
        font-weight: 600;
        color: var(--boxel-dark);
        margin: 0;
      }

      .subscription-header p {
        font: var(--boxel-font);
        color: var(--boxel-500);
        margin: 0;
      }

      .pricing-table {
        border-top: var(--boxel-border);
        padding-top: var(--boxel-sp-lg);
      }
      .feature-labels-column {
        display: none;
      }

      .plan-column {
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius-lg);
        overflow: hidden;
        margin-bottom: var(--boxel-sp-lg);
        background-color: var(--boxel-light);
        position: relative;
      }
      .plan-column.plan-starter {
        background-color: var(--boxel-100);
      }

      .current-plan-badge {
        position: absolute;
        top: var(--boxel-sp);
        right: var(--boxel-sp);
        background-color: var(--boxel-450);
        color: var(--boxel-light);
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        border-radius: 50px;
        font: var(--boxel-font-xs);
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-size: 8px;
      }

      .plan-header {
        padding: var(--boxel-sp-lg);
        text-align: center;
      }
      .plan-column.plan-starter .plan-header {
        background-color: var(--boxel-100);
      }
      .plan-header:not(.plan-starter *) {
        background-color: var(--boxel-light);
      }

      .plan-name {
        font: var(--boxel-font-md);
        font-weight: 600;
        margin: 0 0 var(--boxel-sp-xs) 0;
      }
      .plan-price {
        font: var(--boxel-font-xl);
        font-weight: 700;
        color: var(--boxel-dark);
        line-height: 1;
      }
      .plan-period {
        margin-bottom: var(--boxel-sp);
      }

      .btn {
        display: inline-block;
        padding: var(--boxel-sp-sm) var(--boxel-sp-lg);
        border: none;
        border-radius: 50px;
        text-decoration: none;
        font-weight: 600;
        transition: var(--boxel-transition);
        font: var(--boxel-font-sm);
      }
      .btn-teal {
        background-color: var(--boxel-teal);
        color: var(--boxel-dark);
      }
      .btn-teal:hover {
        background-color: #00d99e;
      }
      .btn-dark {
        background-color: var(--boxel-dark);
        color: var(--boxel-light);
      }
      .btn-dark:hover {
        background-color: #595959;
      }
      .btn-get-started {
        font-weight: 600;
      }

      .feature-cell {
        padding: var(--boxel-sp) var(--boxel-sp);
        font-weight: 500;
        text-align: center;
        border-top: var(--boxel-border);
      }

      .feature-cell::before {
        content: attr(data-label);
        display: block;
        color: var(--boxel-700);
        margin-bottom: var(--boxel-sp-xs);
        text-align: center;
        font: var(--boxel-font-sm);
        font-weight: 600;
      }
      .feature-cell .credit-value {
        margin-top: var(--boxel-sp-xs);
      }

      .credit-value {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-xs);
        font: var(--boxel-font-lg);
        font-weight: 600;
        --icon-color: var(--boxel-teal);
      }
      .feature-note {
        color: var(--boxel-500);
        font: var(--boxel-font-sm);
        margin-top: var(--boxel-sp-xxs);
      }

      .footer-notes {
        text-align: center;
        margin-top: var(--boxel-sp);
        color: var(--boxel-450);
        line-height: 1.5;
        font: var(--boxel-font-xs);
        margin-top: 1.5rem;
      }
      .footer-notes p {
        margin: var(--boxel-sp-xs) 0;
      }
      .footer-notes .highlight {
        display: inline-block;
        background-color: var(--boxel-lime);
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-xs);
        color: var(--boxel-700);
        font-weight: 500;
      }

      @media (min-width: 992px) {
        .pricing-table {
          display: flex;
          border: var(--boxel-border);
          border-radius: var(--boxel-border-radius-lg);
          padding-top: 0;
          overflow: hidden;
        }

        .feature-labels-column {
          display: block;
          flex: 1 1 auto;
          background-color: var(--boxel-light);
          font-weight: 600;
          color: var(--boxel-700);
        }

        .plan-column {
          flex: 0 0 305px;
          border: none;
          border-radius: 0;
          margin-bottom: 0;
        }
        .plan-column:not(:first-of-type) {
          border-left: var(--boxel-border);
        }

        .plan-header {
          background-color: var(--boxel-100);
          min-height: 220px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .feature-cell::before {
          display: none;
        }
        .feature-cell {
          min-height: 100px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }

        .label-cell {
          min-height: 100px;
          padding: var(--boxel-sp);
          font-weight: 600;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .label-cell:not(.is-header) {
          border-top: var(--boxel-border);
        }
        .label-cell.is-header {
          min-height: 220px;
        }

        .credit-value {
          font: var(--boxel-font-lg);
          font-weight: 600;
        }
      }

      @media (max-width: 991px) {
        .btn-get-started {
          padding-left: calc(var(--boxel-sp-lg) + 30px);
          padding-right: calc(var(--boxel-sp-lg) + 30px);
        }
      }

      .choose-subscription-plan-modal {
        --boxel-modal-max-width: 80rem;
        --boxel-modal-offset-top: var(--boxel-sp-xxl);
        height: 90%;
      }
      :global(.boxel-card-container.choose-subscription-plan) {
        border-radius: 20px;
      }
    </style>

    <ModalContainer
      @title=''
      @isOpen={{@isModalOpen}}
      @onClose={{@onClose}}
      @cardContainerClass='choose-subscription-plan'
      class='choose-subscription-plan-modal'
      data-test-choose-subscription-plan-modal
    >

      <:content>
        <div class='boxel-pricing-container'>
          <h1 class='main-title'>Choose a Subscription Plan</h1>

          <p class='early-preview-banner'>
            Access to the Boxel Web App is free during early preview.
          </p>

          <p class='intro-text'>
            To use the included AI features, you need to have Boxel Credits in
            your account. Starter plan includes 2,500 credit per month.
            <br />
            To get more credits, you can subscribe to a monthly plan or buy
            credit packs.
          </p>

          <div class='subscription-header'>
            <div class='subscription-title'>
              <svg
                width='32'
                height='32'
                viewBox='0 0 24 24'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
                stroke='currentColor'
                stroke-width='1.5'
                stroke-linecap='round'
                stroke-linejoin='round'
              >
                <rect x='3' y='4' width='18' height='18' rx='2' ry='2'></rect>
                <line x1='16' y1='2' x2='16' y2='6'></line>
                <line x1='8' y1='2' x2='8' y2='6'></line>
                <line x1='3' y1='10' x2='21' y2='10'></line>
                <path d='M12 14v4m-2-2h4'></path>
              </svg>
              <h2>Monthly Subscription</h2>
            </div>
            <p>Subscribe to get your Boxel Credit account topped up at every
              month</p>
          </div>

          <div class='pricing-table'>
            <div class='feature-labels-column'>
              <div class='label-cell is-header'></div>
              <div class='label-cell'>
                Boxel Credits
                <span class='sub-label'>(For AI Generation)</span>
              </div>
              <div class='label-cell'>Workspaces</div>
              <div class='label-cell'>Cloud Storage</div>
              <div class='label-cell'>Boxel Web App</div>
            </div>

            <div
              class='plan-column plan-starter
                {{if this.isStarterPlan "current-plan"}}'
              data-test-starter-plan-column
            >
              {{#if this.isStarterPlan}}
                <div
                  class='current-plan-badge'
                  data-test-current-plan-badge
                >Current Plan</div>
              {{/if}}
              <div class='plan-header'>
                <h3 class='plan-name'>Starter</h3>
                <div class='plan-price'>$0</div>
                <div class='plan-period'>per month</div>
                <button
                  type='button'
                  class='btn btn-teal btn-get-started'
                  data-test-starter-plan-button
                  {{on
                    'click'
                    (fn
                      this.billingService.redirectToStripe (hash plan='Starter')
                    )
                  }}
                >{{if this.isStarterPlan 'Manage Plan' 'Get Started'}}</button>
              </div>
              <div
                class='feature-cell'
                data-label='Boxel Credits (For AI Generation)'
              >
                <div class='credit-value'>
                  <IconHexagon width='16px' height='16px' />
                  2,500
                </div>
                <div class='feature-note'>Monthly Boxel Credit</div>
              </div>
              <div class='feature-cell' data-label='Workspaces'>Up to 10</div>
              <div class='feature-cell' data-label='Cloud Storage'>500 MB</div>
              <div
                class='feature-cell'
                data-label='Boxel Web App'
              >Included</div>
            </div>

            <div
              class='plan-column plan-creator
                {{if this.isCreatorPlan "current-plan"}}'
              data-test-creator-plan-column
            >
              {{#if this.isCreatorPlan}}
                <div
                  class='current-plan-badge'
                  data-test-current-plan-badge
                >Current Plan</div>
              {{/if}}
              <div class='plan-header'>
                <h3 class='plan-name'>Creator</h3>
                <div class='plan-price'>$12</div>
                <div class='plan-period'>per month</div>
                <button
                  type='button'
                  class='btn btn-dark btn-get-started'
                  data-test-creator-plan-button
                  {{on
                    'click'
                    (fn
                      this.billingService.redirectToStripe (hash plan='Creator')
                    )
                  }}
                >{{if this.isCreatorPlan 'Manage Plan' 'Get Started'}}</button>
              </div>
              <div
                class='feature-cell'
                data-label='Boxel Credits (For AI Generation)'
              >
                <div class='credit-value'>
                  <IconHexagon width='16px' height='16px' />
                  6,500
                </div>
                <div class='feature-note'>Monthly Boxel Credit</div>
              </div>
              <div class='feature-cell' data-label='Workspaces'>Up to 25</div>
              <div class='feature-cell' data-label='Cloud Storage'>5 GB</div>
              <div
                class='feature-cell'
                data-label='Boxel Web App'
              >Included</div>
            </div>

            <div
              class='plan-column plan-power
                {{if this.isPowerUserPlan "current-plan"}}'
              data-test-power-user-plan-column
            >
              {{#if this.isPowerUserPlan}}
                <div
                  class='current-plan-badge'
                  data-test-current-plan-badge
                >Current Plan</div>
              {{/if}}
              <div class='plan-header'>
                <h3 class='plan-name'>Power User</h3>
                <div class='plan-price'>$49</div>
                <div class='plan-period'>per month</div>
                <button
                  type='button'
                  class='btn btn-dark btn-get-started'
                  data-test-power-user-plan-button
                  {{on
                    'click'
                    (fn
                      this.billingService.redirectToStripe
                      (hash plan='Power User')
                    )
                  }}
                >{{if
                    this.isPowerUserPlan
                    'Manage Plan'
                    'Get Started'
                  }}</button>
              </div>
              <div
                class='feature-cell'
                data-label='Boxel Credits (For AI Generation)'
              >
                <div class='credit-value'>
                  <IconHexagon width='16px' height='16px' />
                  35,000
                </div>
                <div class='feature-note'>Monthly Boxel Credit</div>
              </div>
              <div class='feature-cell' data-label='Workspaces'>Up to 150</div>
              <div class='feature-cell' data-label='Cloud Storage'>20 GB</div>
              <div
                class='feature-cell'
                data-label='Boxel Web App'
              >Included</div>
            </div>

          </div>

          <div class='footer-notes'>
            <p><span class='highlight'>You need to provide a valid credit card
                to register and obtain free Boxel Credits.</span></p>
            <p>Your card will not be charged unless you choose to upgrade or buy
              more credits. Unused monthly Boxel Credits do not roll over.</p>
          </div>
        </div>
      </:content>
    </ModalContainer>
  </template>
}
