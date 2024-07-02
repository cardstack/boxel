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
        --boxel-header-gap: var(--boxel-sp-xxs);
        --boxel-header-detail-margin-left: 0;
      }
      :global(.skill-menu.pill-menu--minimized) {
        --boxel-pill-menu-width: 3.75rem;
        white-space: nowrap;
        transition: width 0.2s ease-in;
      }
      :global(.skill-menu.pill-menu--minimized:hover) {
        --boxel-pill-menu-width: 100%;
      }
      :global(.skill-menu.pill-menu--minimized .expandable-header-button),
      :global(.skill-menu.pill-menu--minimized .skills-length) {
        visibility: collapse;
        transition: visibility 0.2s ease-in;
      }
      :global(.skill-menu.pill-menu--minimized:hover .expandable-header-button),
      :global(.skill-menu.pill-menu--minimized:hover .skills-length) {
        visibility: visible;
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
