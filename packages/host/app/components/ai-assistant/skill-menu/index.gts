import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { skillCardRef } from '@cardstack/runtime-common';

import PillMenu, { PillMenuItem } from '@cardstack/host/components/pill-menu';

import { RoomSkill } from '@cardstack/host/resources/room';

interface Signature {
  Element: HTMLDivElement | HTMLButtonElement;
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
      @canAttachCard={{true}}
      @onExpand={{fn this.setExpanded true}}
      @onCollapse={{fn this.setExpanded false}}
      @onChooseCard={{this.attachSkill}}
      @onChangeItemIsActive={{this.updateItemIsActive}}
      tabindex='0'
      ...attributes
    >
      <:headerIcon>
        <span class='header-icon' />
      </:headerIcon>
      <:headerDetail>
        <span
          class='skills-length'
          data-test-active-skills-count
        >{{this.headerText}}</span>
      </:headerDetail>
    </PillMenu>
    <style scoped>
      .header-icon {
        display: inline-block;
        width: 20px;
        height: 18px;
        background-image: url('./robot-head@2x.webp');
        background-position: left center;
        background-repeat: no-repeat;
        background-size: contain;
        flex-shrink: 0;
      }
      .skill-menu {
        --boxel-pill-menu-header-padding: 0;
        --boxel-pill-menu-content-padding: var(--boxel-sp) 0;
        --boxel-pill-menu-footer-padding: 0;
        --boxel-pill-menu-button-padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        background-color: transparent;
        box-shadow: none;
      }
    </style>
  </template>

  @tracked private isExpanded = false;

  @action
  private setExpanded(isExpanded: boolean) {
    this.isExpanded = isExpanded;
  }

  private get headerText() {
    if (this.isExpanded) {
      return `Skills: ${this.activeSkills.length} of ${this.args.skills.length} active`;
    }
    return `Skills ${this.activeSkills.length}`;
  }

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
