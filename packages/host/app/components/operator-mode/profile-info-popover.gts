import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { trackedFunction } from 'ember-resources/util/function';

import { BoxelButton } from '@cardstack/boxel-ui/components';

import { cssVar, or } from '@cardstack/boxel-ui/helpers';

import ProfileAvatarIcon from '@cardstack/host/components/operator-mode/profile-avatar-icon';
import config from '@cardstack/host/config/environment';
import MatrixService from '@cardstack/host/services/matrix-service';
import RealmServerService from '@cardstack/host/services/realm-server';

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
        width: 300px;
        position: absolute;
        bottom: 68px;
        left: 20px;
        z-index: 3;
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
        align-items: center;
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
      .out-of-credit {
        font: var(--boxel-font-sm);
      }
      .info-group .value {
        color: var(--boxel-dark);
        font: 700 var(--boxel-font-sm);
        font-style: capitalize;
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
      {{#if this.isCreditInfoDisplayed}}
        <div class='credit-info' data-test-credit-info>
          <div class='info-group'>
            <span class='label'>Membership Tier</span>
            <span
              class='value'
              data-test-membership-tier
            >{{this.plan.name}}</span>
          </div>
          {{#if this.isChangePlanDisplayed}}
            <BoxelButton
              @kind='secondary-light'
              @size='small'
              data-test-change-plan-button
              {{on 'click' @toggleProfileSettings}}
            >Change plan</BoxelButton>
          {{/if}}
          <div class='info-group'>
            <span class='label'>Monthly Credit</span>
            <span
              class='value'
              style={{if this.isOutOfPlanCreditAllowance 'color:#ff3838'}}
              data-test-monthly-credit
            >{{this.monthlyCreditText}}</span>
          </div>
          {{#if this.isOutOfCredit}}
            <span class='out-of-credit' data-test-out-of-credit>You have used
              all your credits from your monthly plan. Please upgrade your plan
              or buy additional credit to continue.</span>
          {{/if}}
          <div class='info-group'>
            <span class='label'>Additional Credit</span>
            <span class='value' data-test-additional-balance>{{if
                this.isFreePlan
                'Upgrade to Enable'
                this.extraCreditsAvailableInBalance
              }}</span>
          </div>
        </div>
        {{#if (or this.isFreePlan this.isOutOfCredit)}}
          <BoxelButton
            {{on 'click' @toggleProfileSettings}}
            style={{cssVar
              boxel-button-text-color='var(--boxel-dark)'
              boxel-button-color='var(--boxel-teal)'
              boxel-button-border='1px solid var(--boxel-teal)'
            }}
            @kind='primary'
            data-test-choose-plan-button
          >
            Choose Plan
          </BoxelButton>
        {{/if}}
      {{/if}}
    </div>
  </template>

  // TODO: Remove this property once the API integration for credit info is completed.
  private isCreditInfoDisplayed = config.environment === 'test';

  @service private declare realmServer: RealmServerService;
  @service declare matrixService: MatrixService;

  @action private logout() {
    this.matrixService.logout();
  }

  private fetchCreditInfo = trackedFunction(this, async () => {
    return await this.realmServer.fetchCreditInfo();
  });

  private get plan() {
    return this.fetchCreditInfo.value?.plan;
  }

  private get creditsIncludedInPlanAllowance() {
    return this.fetchCreditInfo.value?.creditsIncludedInPlanAllowance;
  }

  private get creditsUsedInPlanAllowance() {
    return this.fetchCreditInfo.value?.creditsUsedInPlanAllowance;
  }

  private get extraCreditsAvailableInBalance() {
    return this.fetchCreditInfo.value?.extraCreditsAvailableInBalance;
  }

  private get monthlyCreditText() {
    return this.creditsUsedInPlanAllowance != undefined &&
      this.creditsIncludedInPlanAllowance != undefined
      ? `${
          this.creditsIncludedInPlanAllowance - this.creditsUsedInPlanAllowance
        } of ${this.creditsIncludedInPlanAllowance} left`
      : '';
  }

  private get isOutOfCredit() {
    return (
      this.isOutOfPlanCreditAllowance &&
      this.extraCreditsAvailableInBalance == 0
    );
  }

  private get isOutOfPlanCreditAllowance() {
    return (
      this.creditsUsedInPlanAllowance &&
      this.creditsIncludedInPlanAllowance &&
      this.creditsUsedInPlanAllowance >= this.creditsIncludedInPlanAllowance
    );
  }

  private get isFreePlan() {
    return this.plan && this.plan.monthlyPrice == 0;
  }

  private get isChangePlanDisplayed() {
    return this.plan && !this.isFreePlan && !this.isOutOfCredit;
  }
}

export class ProfileInfo extends Component<ProfileInfoSignature> {
  @service declare matrixService: MatrixService;

  <template>
    <div class='profile-popover-body' data-test-profile-icon-container>
      <ProfileAvatarIcon @userId={{this.matrixService.userId}} />

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
      }

      .profile-handle {
        margin-top: var(--boxel-sp-xxxxs);
        color: var(--boxel-500);
      }
    </style>
  </template>
}
