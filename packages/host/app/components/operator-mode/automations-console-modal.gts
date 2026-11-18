import { service } from '@ember/service';
import Component from '@glimmer/component';

import { AutomationsConsole } from '@cardstack/base/realm-automations';
import { Dialog } from '@cardstack/pretui/components/dialog';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type ToolService from '@cardstack/host/services/tool-service';

import type { CardContext } from '@cardstack/base/card-api';

// A realm's automations console, opened from the realm config card's "…"
// menu or its Automations entry. The list itself is base's
// `AutomationsConsole`, the same reader the realm config's entry uses, so the
// console and the entry never disagree about an automation.
export default class AutomationsConsoleModal extends Component {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private toolService: ToolService;

  private get payload() {
    return this.operatorModeStateService.automationsConsole;
  }

  private get title() {
    let realm = this.payload?.realm;
    let name = realm ? this.realm.info(realm)?.name : undefined;
    return name ? `Automations in ${name}` : 'Automations';
  }

  private get context(): CardContext {
    return {
      toolContext: this.toolService.toolContext,
    } as unknown as CardContext;
  }

  private close = () => {
    this.operatorModeStateService.dismissAutomationsConsole();
  };

  <template>
    {{#if this.payload}}
      <Dialog
        @open={{true}}
        @onClose={{this.close}}
        @label={{this.title}}
        @size='l'
        data-test-automations-console-modal
      >
        <:title>{{this.title}}</:title>
        <:default>
          <AutomationsConsole
            @realm={{this.payload.realm}}
            @context={{this.context}}
          />
        </:default>
      </Dialog>
    {{/if}}
  </template>
}
