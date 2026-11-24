import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Alert } from '@cardstack/pretui/components/alert';
import { restartableTask } from 'ember-concurrency';

import type LoaderService from '@cardstack/host/services/loader-service';
import type StoreService from '@cardstack/host/services/store';
import {
  findDanglingRoutingRules,
  type DanglingRoutingRule,
} from '@cardstack/host/utils/dangling-routing-rules';

import type * as CardAPI from '@cardstack/base/card-api';

interface Signature {
  Args: { realmURL: string };
}

// Warns that some of the realm's host routing rules point to a card that no
// longer exists. Shows nothing until it finds one.
export default class DanglingRoutingWarning extends Component<Signature> {
  @service declare private loaderService: LoaderService;
  @service declare private store: StoreService;

  @tracked private rules: DanglingRoutingRule[] = [];

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.checkTask.perform();
  }

  private checkTask = restartableTask(async () => {
    try {
      let api = await this.loaderService.loader.import<typeof CardAPI>(
        '@cardstack/base/card-api',
      );
      this.rules = await findDanglingRoutingRules(
        this.store,
        api,
        this.args.realmURL,
      );
    } catch (error) {
      console.error('Failed to check for dangling routing rules', error);
      this.rules = [];
    }
  });

  <template>
    {{#if this.rules.length}}
      <div class='dangling-routing-warning'>
        <Alert
          @tone='warning'
          @title='Some host routing rules point to a card that no longer exists'
          data-test-dangling-routing-warning
        >
          Visitors to these paths get a “page not found” error at each host URL.
          <ul class='rules'>
            {{#each this.rules as |rule|}}
              <li data-test-dangling-routing-rule={{rule.path}}>
                <code>{{rule.path}}</code>
                <span aria-hidden='true'>→</span>
                {{rule.reference}}
              </li>
            {{/each}}
          </ul>
        </Alert>
      </div>
    {{/if}}
    <style scoped>
      .dangling-routing-warning {
        margin-bottom: var(--boxel-sp-lg);
      }
      .rules {
        margin: var(--boxel-sp-xxs) 0 0;
        padding-inline-start: var(--boxel-sp);
      }
      .rules li {
        overflow-wrap: break-word;
      }
    </style>
  </template>
}
