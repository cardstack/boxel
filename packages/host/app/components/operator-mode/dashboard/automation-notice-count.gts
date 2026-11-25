import { service } from '@ember/service';
import Component from '@glimmer/component';

import { Chip } from '@cardstack/pretui/components/chip';

import { eq } from '@cardstack/boxel-ui/helpers';

import type AutomationNoticesService from '@cardstack/host/services/automation-notices';

import type { ComponentLike } from '@glint/template';

// How many of the user's automation notices are about automations in one
// workspace, as a chip under the workspace menu's Realm Settings item, which
// opens the realm config whose Automations section lists them. Renders
// nothing while there are none.
class AutomationNoticeCount extends Component {
  @service declare private automationNotices: AutomationNoticesService;

  // The workspace, set by the subclass `automationNoticeCount` makes, since
  // a menu item's component takes no arguments.
  protected realm: string | undefined;

  private get count() {
    return this.automationNotices.countFor(this.realm);
  }

  <template>
    {{#if this.count}}
      <Chip
        @tone='danger'
        @appearance='soft'
        data-test-realm-settings-automation-notices={{this.count}}
      >
        {{this.count}}
        {{if (eq this.count 1) 'automation needs' 'automations need'}}
        attention
      </Chip>
    {{/if}}
  </template>
}

export function automationNoticeCount(realm: string): ComponentLike {
  return class WorkspaceAutomationNoticeCount extends AutomationNoticeCount {
    protected realm = realm;
  };
}
