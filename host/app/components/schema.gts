import Component from '@glimmer/component';
import { CardRef } from '@cardstack/runtime-common';
import { getCardType } from '../resources/card-type';
import { action } from '@ember/object';
import { service } from '@ember/service';
import LocalRealm from '../services/local-realm';
import { RealmPaths } from '@cardstack/runtime-common/paths';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';
import { LinkTo } from '@ember/routing';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';

interface Signature {
  Args: {
    ref: CardRef
  }
}

export default class Schema extends Component<Signature> {
  <template>
    {{#if this.cardType.type}}
      <p>
        <div data-test-card-id>Card ID: {{this.cardType.type.id}}</div>
        <div data-test-adopts-from>Adopts From: {{this.cardType.type.super.id}}</div>
        <div>Fields:</div>
        <ul>
          {{#each this.cardType.type.fields as |field|}}
            <li data-test-field={{field.name}}>{{field.name}} - {{field.type}} - field card ID: 
              {{#if (this.inRealm field.card.exportedCardContext.module)}}
                <LinkTo
                  @route="application"
                  @query={{hash path=(this.modulePath field.card.exportedCardContext.module)}}
                >
                  {{field.card.id}}
                </LinkTo>
              {{else}}
                {{field.card.id}}
              {{/if}}
            </li>
          {{/each}}
        </ul>
      </p>
    {{/if}}
  </template>

  @service declare localRealm: LocalRealm;
  cardType = getCardType(this, () => this.args.ref);

  @cached
  get realmPath() {
    if (!this.localRealm.isAvailable) {
      throw new Error('Local realm is not available');
    }
    return new RealmPaths(this.localRealm.url);
  }

  @action
  inRealm(url: string): boolean {
    return this.realmPath.inRealm(new URL(url));
  }

  @action
  modulePath(url: string): string {
    return this.realmPath.local(new URL(url));
  }
}