import { Chain } from './chain';
import {
  Card,
  contains,
  field,
  StringCard,
  Component,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { Button, CardContainer, FieldContainer } from '@cardstack/boxel-ui';
import { tracked } from '@glimmer/tracking';
// @ts-ignore
import MetamaskResource from 'metamask-resource';
// @ts-ignore
import { enqueueTask, restartableTask } from 'ember-concurrency';
// @ts-ignore
import { on } from '@ember/modifier';
// @ts-ignore
import { action } from '@ember/object';

class Isolated extends Component<typeof Claim> {
  @tracked chainId = -1;
  metamask;
  <template>
    <CardContainer class='demo-card' @displayBoundaries={{true}}>
      <FieldContainer @label='Module Address.'><@fields.moduleAddress
        /></FieldContainer>
      <FieldContainer @label='Safe Address'><@fields.safeAddress
        /></FieldContainer>
      <FieldContainer @label='Explanation'><@fields.explanation
        /></FieldContainer>
      <FieldContainer @label='Chain'><@fields.chain /></FieldContainer>
      {{#if this.connected}}
        <Button {{on 'click' this.claim}}>
          {{#if this.metamask.doClaim.isRunning}}
            Claiming...
          {{else}}
            Claim
          {{/if}}
        </Button>
      {{else}}
        <Button {{on 'click' this.connectMetamask}}>
          {{#if this.metamask.doConnectMetamask.isRunning}}
            Connecting...
          {{else}}
            Connect
          {{/if}}
        </Button>
      {{/if}}
    </CardContainer>
  </template>

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.chainId = this.args.model.chain?.chainId ?? -1;
    this.metamask = new MetamaskResource({
      named: { chainId: this.chainId },
    }).setup();
  }

  get connected() {
    return this.chainId == this.metamask.chainId && this.metamask.connected;
  }

  @action
  private claim() {
    this.metamask.doClaim.perform();
  }

  @action
  private connectMetamask() {
    this.metamask.doConnectMetamask.perform(this.chainId);
  }
}

export class Claim extends Card {
  static displayName = 'Claim';
  @field moduleAddress = contains(StringCard);
  @field safeAddress = contains(StringCard);
  @field explanation = contains(StringCard);
  @field signature = contains(StringCard);
  @field encoding = contains(StringCard);
  @field chain = linksTo(() => Chain);
  @field title = contains(StringCard, {
    computeVia: function (this: Claim) {
      return `Claim for ${this.safeAddress}`;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='demo-card' @displayBoundaries={{true}}>
        <FieldContainer @label='Title'><@fields.title /></FieldContainer>
        <FieldContainer @label='Explanation'><@fields.explanation
          /></FieldContainer>
        <FieldContainer @label='Chain'><@fields.chain /></FieldContainer>
        <Button>
          Look at Claim
        </Button>
      </CardContainer>
    </template>
  };
  static isolated = Isolated;
}
