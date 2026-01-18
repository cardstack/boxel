import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { formatDistanceToNow } from 'date-fns';
import { task } from 'ember-concurrency';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';
import { cn, formatNumber } from '@cardstack/boxel-ui/helpers';
import { IconHexagon } from '@cardstack/boxel-ui/icons';

import type BillingService from '../services/billing-service';

import type { ComponentLike } from '@glint/template';

function formatLocalTimestamp(date: Date) {
  let formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return formatter.format(date);
}

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
        dailyGrantNote: string[] | null;
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
    this.loadSubscriptionData.perform();
  }

  private get isLoading() {
    return this.billingService.loadingSubscriptionData;
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

  private get lowCreditThreshold() {
    return this.billingService.subscriptionData?.lowCreditThreshold ?? null;
  }

  private get lastDailyCreditGrantAt() {
    return this.billingService.subscriptionData?.lastDailyCreditGrantAt;
  }

  private get nextDailyCreditGrantAt() {
    return this.billingService.subscriptionData?.nextDailyCreditGrantAt;
  }

  private get monthlyCreditText() {
    return this.creditsAvailableInPlanAllowance != null &&
      this.creditsIncludedInPlanAllowance != null
      ? `${formatNumber(this.creditsAvailableInPlanAllowance, {
          size: 'short',
        })} of ${formatNumber(this.creditsIncludedInPlanAllowance, {
          size: 'short',
        })} left`
      : 'Not available on Free plan';
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

  private get dailyGrantNote() {
    if (this.isLoading || this.lowCreditThreshold == null) {
      return null;
    }

    let availableCredits = this.billingService.availableCredits;
    if (availableCredits < this.lowCreditThreshold) {
      if (!this.nextDailyCreditGrantAt) {
        return null;
      }
      let distance = formatDistanceToNow(
        new Date(this.nextDailyCreditGrantAt * 1000),
      );
      let timestampLocal = formatLocalTimestamp(
        new Date(this.nextDailyCreditGrantAt * 1000),
      );
      let creditAmount = formatNumber(this.lowCreditThreshold, {
        size: 'short',
      });
      return [
        `Next free credit daily grant will top up your balance to ${creditAmount} credits in ${distance} (${timestampLocal}).`,
      ];
    }

    if (!this.lastDailyCreditGrantAt) {
      return null;
    }

    let distance = formatDistanceToNow(
      new Date(this.lastDailyCreditGrantAt * 1000),
      {
        addSuffix: true,
      },
    );
    let timestampLastDailyCreditGrant = formatLocalTimestamp(
      new Date(this.lastDailyCreditGrantAt * 1000),
    );
    let thresholdAmount = formatNumber(this.lowCreditThreshold, {
      size: 'short',
    });
    return [
      `We topped up your account to ${thresholdAmount} credits since you were getting low.`,
      `Last daily credits grant: ${distance} (${timestampLastDailyCreditGrant})`,
    ];
  }

  private loadSubscriptionData = task(async () => {
    await this.billingService.loadSubscriptionData();
  });

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
          value=(formatNumber this.extraCreditsAvailableInBalance size='short')
          isLoading=this.isLoading
          isOutOfCredit=this.isOutOfCredit
          displayCreditIcon=true
        )
        dailyGrantNote=this.dailyGrantNote
        isOutOfCredit=this.isOutOfCredit
        isLoading=this.isLoading
      )
    }}
  </template>
}
