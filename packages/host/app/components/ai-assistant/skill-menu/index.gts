import Component from '@glimmer/component';

import { skillCardRef } from '@cardstack/runtime-common';

import PillMenu, { PillMenuItem } from '@cardstack/host/components/pill-menu';

import { RoomSkill } from '@cardstack/host/resources/room';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    skills: RoomSkill[];
    onChooseCard?: (cardId: string) => void;
    onUpdateSkillIsActive?: (isActive: boolean, skillCardId: string) => void;
  };
}

export default class AiAssistantSkillMenu extends Component<Signature> {
  <template>
    <PillMenu
      class='skill-menu'
      @query={{this.query}}
      @items={{@skills}}
      @itemDisplayName='Skill'
      @isExpandableHeader={{true}}
      @canAttachCard={{true}}
      @onChooseCard={{this.attachSkill}}
      @onChangeItemIsActive={{this.updateItemIsActive}}
      tabindex='0'
      ...attributes
    >
      <:headerIcon>
        <span class='header-icon' />
      </:headerIcon>
      <:headerDetail>
        <span class='skills-length' data-test-active-skills-count>Skills
          {{this.activeSkills.length}}</span>
        <span class='expand-skills-length'>Skills:
          {{this.activeSkills.length}}
          of
          {{@skills.length}}
        </span>
      </:headerDetail>
    </PillMenu>
    <style scoped>
      .skill-menu {
        --boxel-header-gap: var(--boxel-sp-xxs);
        --boxel-header-detail-margin-left: 0;
      }
      .skill-menu.pill-menu--minimized {
        --boxel-pill-menu-width: fit-content;
        white-space: nowrap;
        transition: width 0.2s ease-in;
      }
      .skill-menu.pill-menu--minimized:focus {
        outline: 0;
      }
      .skill-menu.pill-menu--minimized :deep(.expandable-header-button),
      .skill-menu.pill-menu--minimized :deep(.skills-length) {
        display: block;
      }
      .skill-menu.pill-menu--minimized :deep(.expand-skills-length) {
        display: none;
      }

      .skill-menu:not(.pill-menu--minimized) :deep(.skills-length) {
        display: none;
      }
      .skill-menu:not(.pill-menu--minimized) :deep(.expand-skills-length) {
        display: block;
      }
      .header-icon {
        width: 20px;
        height: 18px;
        background-image: url('./robot-head@2x.webp');
        background-position: left center;
        background-repeat: no-repeat;
        background-size: contain;
        flex-shrink: 0;
      }
    </style>
  </template>

  private get query() {
    let selectedCardIds =
      this.args.skills?.map((skill: RoomSkill) => ({
        not: { eq: { id: skill.cardId } },
      })) ?? [];
    // query for only displaying skill cards that are not already selected
    return {
      filter: {
        every: [{ type: skillCardRef }, ...selectedCardIds],
      },
    };
  }

  private get activeSkills() {
    return this.args.skills?.filter((skill) => skill.isActive) ?? [];
  }

  attachSkill = (skillCardId: string) => {
    this.args.onChooseCard?.(skillCardId);
  };

  updateItemIsActive = (item: PillMenuItem, isActive: boolean) => {
    this.args.onUpdateSkillIsActive?.(
      isActive,
      (item as RoomSkill).fileDef.sourceUrl,
    );
  };
}
