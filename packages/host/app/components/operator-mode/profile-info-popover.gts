import { on } from '@ember/modifier';

import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { trackedFunction } from 'ember-resources/util/function';

import { BoxelButton } from '@cardstack/boxel-ui/components';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import ProfileAvatarIcon from '@cardstack/host/components/operator-mode/profile-avatar-icon';
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
        height: 363px;
        position: absolute;
        bottom: 68px;
        left: 20px;
        z-index: 3;
        background: white;
        padding: var(--boxel-sp);
        flex-direction: column;
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-deep-box-shadow);
        display: flex;
      }

      .display-choose-plan-button {
        height: 425px;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .header .label {
        color: var(--boxel-dark);
        text-transform: uppercase;
      }

      .credit-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        margin-bottom: auto;
        padding-top: var(--boxel-sp-lg);
        border-top: 1px solid var(--boxel-dark);
      }
      .info-group {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }
      .info-group .label {
        color: var(--boxel-dark);
        font: var(--boxel-font-sm);
      }
      .info-group .value {
        color: var(--boxel-dark);
        font: 700 var(--boxel-font-sm);
        font-style: capitalize;
      }
      .change-plan,
      .buy-credits {
        font: 700 var(--boxel-font-sm);
        cursor: pointer;
        justify-content: flex-start;
        padding: 0;
      }
      .credit-info__top {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
      }
      .credit-info__bottom {
        display: flex;
        gap: var(--boxel-sp-lg);
      }
    </style>

    <div
      class={{cn
        'profile-popover'
        display-choose-plan-button=this.isChoosePlanButtonDisplayed
      }}
      data-test-profile-popover
      ...attributes
    >
      <header class='header'>
        <div class='label'>
          Signed in as
        </div>

        <BoxelButton
          @kind='secondary-light'
          @size='extra-small'
          {{on 'click' @toggleProfileSettings}}
          data-test-settings-button
        >
          Settings
        </BoxelButton>
      </header>

      <ProfileInfo />
      <div class='credit-info' data-test-credit-info>
        <div class='credit-info__top'>
          <div class='info-group'>
            <span class='label'>Membership Tier</span>
            <span class='value' data-test-membership-tier>{{this.plan}}</span>
          </div>
          {{#if this.isChangePlanDisplayed}}
            <BoxelButton
              class='change-plan'
              @kind='text-only'
              data-test-change-plan-button
              {{on 'click' @toggleProfileSettings}}
            >Change plan</BoxelButton>
          {{/if}}
        </div>
        <div class='credit-info__bottom'>
          <div class='info-group'>
            <span class='label'>Monthly Credit</span>
            <span
              class='value'
              data-test-monthly-credit
            >{{this.monthlyCredit}}</span>
          </div>
          <div class='info-group'>
            <span class='label'>Additional Balance</span>
            {{#if (eq this.creditsAvailableInBalance 0)}}
              <BoxelButton
                class='buy-credits'
                {{on 'click' @toggleProfileSettings}}
                @kind='text-only'
                data-test-buy-additional-credits
              >Buy Credits</BoxelButton>
            {{else}}
              <span
                class='value'
                data-test-additional-balance
              >{{this.creditsAvailableInBalance}}</span>
            {{/if}}
          </div>
        </div>
      </div>
      {{#if this.isChoosePlanButtonDisplayed}}
        <BoxelButton
          {{on 'click' @toggleProfileSettings}}
          @kind='primary-dark'
          data-test-choose-plan-button
        >
          Choose Plan
        </BoxelButton>
      {{/if}}
    </div>
  </template>

  @service private declare realmServer: RealmServerService;

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

  private get creditsAvailableInBalance() {
    return this.fetchCreditInfo.value?.creditsAvailableInBalance;
  }

  private get monthlyCredit() {
    return this.creditsUsedInPlanAllowance != undefined &&
      this.creditsIncludedInPlanAllowance != undefined
      ? `${this.creditsUsedInPlanAllowance} of ${this.creditsIncludedInPlanAllowance} left`
      : '';
  }

  private get isChoosePlanButtonDisplayed() {
    return this.plan === 'Free';
  }

  private get isChangePlanDisplayed() {
    return this.plan && !this.isChoosePlanButtonDisplayed;
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
