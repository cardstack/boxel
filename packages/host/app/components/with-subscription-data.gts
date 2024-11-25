import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { task } from 'ember-concurrency';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { IconHexagon } from '@cardstack/boxel-ui/icons';

import BillingService from '../services/billing-service';

import type { ComponentLike } from '@glint/template';

interface ValueSignature {
  Args: {
    tag: string;
    value: string | number | null;
    isOutOfCredit: boolean;
    isLoading: boolean;
    displayCreditIcon: boolean;
  };
  Element: HTMLElement;
}

const Value: TemplateOnlyComponent<ValueSignature> = <template>
  <span
    class={{cn 'value' out-of-credit=@isOutOfCredit}}
    data-test-subscription-data={{@tag}}
  >{{#if @isLoading}}
      <LoadingIndicator />
    {{else}}
      {{#if @displayCreditIcon}}
        <IconHexagon width='16px' height='16px' />
      {{/if}}
      {{@value}}
    {{/if}}</span>
  <style scoped>
    .value {
      color: var(--boxel-dark);
      font: 600 var(--boxel-font-sm);
      display: flex;
      align-items: center;
      gap: var(--boxel-sp-4xs);

      --icon-color: var(--boxel-teal);
      --boxel-loading-indicator-size: var(--boxel-icon-xs);
    }
    .value.out-of-credit {
      --icon-color: #ff0000;
      color: #ff0000;
    }
  </style>
</template>;

interface WithSubscriptionDataSignature {
  Args: {};
  Blocks: {
    default: [
      {
        plan: ComponentLike;
        monthlyCredit: ComponentLike;
        additionalCredit: ComponentLike;
        isOutOfCredit: boolean;
        isLoading: boolean;
      },
    ];
  };
}

export default class WithSubscriptionData extends Component<WithSubscriptionDataSignature> {
  @service declare billingService: BillingService;

  constructor(...args: [any, any]) {
    super(...args);
    this.fetchCreditInfo.perform();
  }

  private fetchCreditInfo = task(async () => {
    await this.billingService.fetchSubscriptionData();
  });

  private get isLoading() {
    return (
      this.fetchCreditInfo.isRunning ||
      this.billingService.fetchingSubscriptionData
    );
  }

  private get plan() {
    return this.billingService.subscriptionData?.plan;
  }

  private get creditsIncludedInPlanAllowance() {
    return this.billingService.subscriptionData?.creditsIncludedInPlanAllowance;
  }

  private get creditsAvailableInPlanAllowance() {
    return this.billingService.subscriptionData
      ?.creditsAvailableInPlanAllowance;
  }

  private get extraCreditsAvailableInBalance() {
    return this.billingService.subscriptionData?.extraCreditsAvailableInBalance;
  }

  private get monthlyCreditText() {
    return this.creditsAvailableInPlanAllowance != null &&
      this.creditsIncludedInPlanAllowance != null
      ? `${this.creditsAvailableInPlanAllowance} of ${this.creditsIncludedInPlanAllowance} left`
      : null;
  }

  private get isOutOfCredit() {
    return (
      this.isOutOfPlanCreditAllowance &&
      (this.extraCreditsAvailableInBalance == null ||
        this.extraCreditsAvailableInBalance == 0)
    );
  }

  private get isOutOfPlanCreditAllowance() {
    return (
      this.creditsAvailableInPlanAllowance == null ||
      this.creditsIncludedInPlanAllowance == null ||
      this.creditsAvailableInPlanAllowance <= 0
    );
  }

  <template>
    {{yield
      (hash
        plan=(component
          Value
          tag='plan'
          value=this.plan
          isLoading=this.isLoading
          isOutOfCredit=false
          displayCreditIcon=false
        )
        monthlyCredit=(component
          Value
          tag='monthly-credit'
          value=this.monthlyCreditText
          isLoading=this.isLoading
          isOutOfCredit=this.isOutOfPlanCreditAllowance
          displayCreditIcon=true
        )
        additionalCredit=(component
          Value
          tag='additional-credit'
          value=this.extraCreditsAvailableInBalance
          isLoading=this.isLoading
          isOutOfCredit=this.isOutOfCredit
          displayCreditIcon=true
        )
        isOutOfCredit=this.isOutOfCredit
        isLoading=this.isLoading
      )
    }}
  </template>
}
