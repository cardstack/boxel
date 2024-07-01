import Component from '@glimmer/component';

import PillMenu from '@cardstack/host/components/pill-menu';
import type { PillMenuItem } from '@cardstack/host/components/pill-menu';

import type { CardDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    skills: PillMenuItem[];
    onChooseCard?: (card: CardDef) => void;
  };
}

export default class AiAssistantSkillMenu extends Component<Signature> {
  <template>
    <PillMenu
      class='skill-menu'
      @items={{@skills}}
      @isExpandableHeader={{true}}
      @canAttachCard={{true}}
      @onChooseCard={{@onChooseCard}}
    >
      <:header-icon>
        <span class='header-icon' />
      </:header-icon>
      <:header-detail>
        {{this.activeSkills.length}}
        <span class='maybe-hidden skills-length'>of
          {{@skills.length}}
          Skills Active
        </span>
      </:header-detail>
    </PillMenu>
    <style>
      .skill-menu {
        --boxel-header-detail-margin-left: 0;
      }
      .header-icon {
        width: 20px;
        height: 18px;
        background-image: url('./robot-head.webp');
        background-position: left center;
        background-repeat: no-repeat;
        background-size: contain;
      }
    </style>
  </template>

  private get activeSkills() {
    return this.args.skills.filter((skill) => skill.isActive);
  }
}
