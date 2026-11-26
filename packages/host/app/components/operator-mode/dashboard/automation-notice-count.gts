import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { Badge } from '@cardstack/pretui/components/badge';
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
        @tone='attention'
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

interface WorkspaceIconCountSignature {
  Args: { count: number };
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

// A workspace's icon with the count of its automation notices on its corner.
// The count is only seen here: the workspace's own button carries the spoken
// count as a description (see `Workspace`), so this mark is hidden from
// assistive tech and never becomes part of the button's name.
export const WorkspaceIconCount: TemplateOnlyComponent<WorkspaceIconCountSignature> =
  <template>
    <span class='icon-with-count' ...attributes>
      {{yield}}
      {{#if @count}}
        <span class='count-mark' aria-hidden='true'>
          <Badge @count={{@count}} @tone='attention' class='count-badge'>
            <span class='count-anchor'></span>
          </Badge>
        </span>
      {{/if}}
    </span>
    <style scoped>
      .icon-with-count {
        position: relative;
        display: inline-flex;
      }
      .count-mark {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .count-badge,
      .count-anchor {
        display: block;
        inline-size: 100%;
        block-size: 100%;
      }
    </style>
  </template>;
