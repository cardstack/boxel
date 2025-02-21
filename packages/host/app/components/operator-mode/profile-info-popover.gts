import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { Avatar, BoxelButton } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

import WithSubscriptionData from '@cardstack/host/components/with-subscription-data';

import BillingService from '@cardstack/host/services/billing-service';
import MatrixService from '@cardstack/host/services/matrix-service';

interface ProfileInfoPopoverSignature {
  Args: {
    toggleProfileSettings: () => void;
  };
  Element: HTMLElement;
}

interface ProfileInfoSignature {
  Args: {};
  Element: HTMLElement;
}

export default class ProfileInfoPopover extends Component<ProfileInfoPopoverSignature> {
  <template>
    <style scoped>
      .profile-popover {
        width: 320px;
        position: absolute;
        bottom: 68px;
        left: 20px;
        z-index: var(--host-profile-popover-z-index);
        background: var(--boxel-100);
        padding: var(--boxel-sp);
        flex-direction: column;
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-deep-box-shadow);
        display: flex;
      }
      :deep(.profile-popover-body) {
        padding: var(--boxel-sp-xl) 0;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .header button {
        --boxel-button-font: 600 var(--boxel-font-xs);
      }

      .credit-info {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--boxel-sp-lg);
        margin-bottom: var(--boxel-sp);
        padding-top: var(--boxel-sp-lg);
        border-top: 1px solid var(--boxel-dark);
      }
      .info-group {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }
      .label {
        color: var(--boxel-dark);
        font: var(--boxel-font-xs);
      }
      .info-group .value {
        color: var(--boxel-dark);
        font: 700 var(--boxel-font-sm);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);

        --icon-color: var(--boxel-teal);
        --boxel-loading-indicator-size: var(--boxel-icon-xs);
      }
      .info-group .value.out-of-credit {
        --icon-color: #ff0000;
        color: #ff0000;
      }
      .info-group.additional-credit {
        align-items: flex-end;
      }

      .info-group button {
        margin-top: var(--boxel-sp-xs);
      }

      .buy-more-credits {
        display: flex;
        justify-content: flex-end;
        width: 100%;
        margin-top: calc(-1 * var(--boxel-sp-sm));
      }
      .buy-more-credits.out-of-credit {
        justify-content: center;
        margin-top: var(--boxel-sp-sm);
        --boxel-button-min-width: 100%;
      }
      :deep(.buy-more-credits.out-of-credit .size-base) {
        --boxel-button-min-height: 39px;
      }
    </style>

    <div class='profile-popover' data-test-profile-popover ...attributes>
      <header class='header'>
        <BoxelButton
          @kind='secondary-light'
          @size='small'
          {{on 'click' @toggleProfileSettings}}
          data-test-settings-button
        >
          Settings
        </BoxelButton>

        <BoxelButton
          @kind='primary-dark'
          @size='small'
          {{on 'click' this.logout}}
          data-test-signout-button
        >
          Sign Out
        </BoxelButton>
      </header>

      <ProfileInfo />
      <WithSubscriptionData as |subscriptionData|>
        {{! Show credit info if the user has an active plan }}
        {{#if subscriptionData.hasActiveSubscription}}
          <div class='credit-info' data-test-credit-info>
            <div class='info-group'>
              <span class='label'>Membership Tier</span>
              {{subscriptionData.plan}}
            </div>
            <BoxelButton
              @as='anchor'
              @kind='secondary-light'
              @size='small'
              @disabled={{this.billingService.fetchingStripePaymentLinks}}
              @href={{this.billingService.customerPortalLink}}
              target='_blank'
              data-test-upgrade-plan-button
            >Upgrade Plan</BoxelButton>
            <div class='info-group'>
              <span class='label'>Monthly Credit</span>
              {{subscriptionData.monthlyCredit}}
            </div>
            <div class='info-group additional-credit'>
              <span class='label'>Additional Credit</span>
              {{subscriptionData.additionalCredit}}
            </div>
            <div
              class={{cn
                'buy-more-credits'
                out-of-credit=subscriptionData.isOutOfCredit
              }}
              data-test-buy-more-credits
            >
              <BoxelButton
                @kind={{if
                  subscriptionData.isOutOfCredit
                  'primary'
                  'secondary-light'
                }}
                @size={{if subscriptionData.isOutOfCredit 'base' 'small'}}
                @disabled={{this.billingService.fetchingStripePaymentLinks}}
                {{on 'click' @toggleProfileSettings}}
              >Buy more credits</BoxelButton>
            </div>
          </div>
        {{/if}}
      </WithSubscriptionData>

    </div>
  </template>

  @service declare matrixService: MatrixService;
  @service declare billingService: BillingService;

  @action private logout() {
    this.matrixService.logout();
  }
}

export class ProfileInfo extends Component<ProfileInfoSignature> {
  @service declare matrixService: MatrixService;

  <template>
    <div class='profile-popover-body' data-test-profile-icon-container>
      <Avatar
        @isReady={{this.matrixService.profile.loaded}}
        @userId={{this.matrixService.userId}}
        @displayName={{this.matrixService.profile.displayName}}
      />

      <div class='display-name' data-test-profile-display-name>
        {{this.matrixService.profile.displayName}}
      </div>

      <div class='profile-handle' data-test-profile-icon-handle>
        {{this.matrixService.userId}}
      </div>
    </div>
    <style scoped>
      .profile-popover-body {
        margin: auto;
        display: flex;
        flex-direction: column;
        max-width: 100%;
        overflow: hidden;
        --profile-avatar-icon-size: 70px;
        --profile-avatar-icon-border: 0;
      }

      .profile-popover-body > * {
        margin: auto;
      }

      .display-name {
        margin-top: var(--boxel-sp-xxxs);
        font-size: var(--boxel-font-size);
        font-weight: 600;
        max-width: 100%;
        text-wrap: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .profile-handle {
        margin-top: var(--boxel-sp-xxxxs);
        color: var(--boxel-500);
        max-width: 100%;
        text-wrap: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </template>
}
