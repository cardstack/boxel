import { action } from '@ember/object';
import Component from '@glimmer/component';

import { eq } from '@cardstack/boxel-ui/helpers';

import { skillCardRef } from '@cardstack/runtime-common';

import PillMenu from '@cardstack/host/components/pill-menu';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { SkillCard } from 'https://cardstack.com/base/skill-card';

export type Skill = {
  card: SkillCard;
  isActive: boolean;
};

interface Signature {
  Element: HTMLDivElement;
  Args: {
    skills: Skill[];
    onChooseCard?: (card: SkillCard) => void;
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
      tabindex='0'
      ...attributes
    >
      <:headerIcon>
        <span class='header-icon' />
      </:headerIcon>
      <:headerDetail>
        {{this.activeSkills.length}}
        <span class='skills-length'>of
          {{@skills.length}}
          {{if (eq @skills.length 1) 'Skill' 'Skills'}}
          Active
        </span>
      </:headerDetail>
    </PillMenu>
    <style scoped>
      .skill-menu {
        --boxel-header-gap: var(--boxel-sp-xxs);
        --boxel-header-detail-margin-left: 0;
      }
      .skill-menu.pill-menu--minimized {
        --boxel-pill-menu-width: 3.75rem;
        white-space: nowrap;
        transition: width 0.2s ease-in;
      }
      .skill-menu.pill-menu--minimized:focus {
        outline: 0;
      }
      .skill-menu.pill-menu--minimized:hover,
      .skill-menu.pill-menu--minimized:focus-within {
        --boxel-pill-menu-width: 100%;
      }
      .skill-menu.pill-menu--minimized :deep(.expandable-header-button),
      .skill-menu.pill-menu--minimized :deep(.skills-length) {
        visibility: collapse;
        transition: visibility 0.2s ease-in;
      }
      .skill-menu.pill-menu--minimized:hover :deep(.expandable-header-button),
      .skill-menu.pill-menu--minimized:hover :deep(.skills-length),
      .skill-menu.pill-menu--minimized:focus-within
        :deep(.expandable-header-button),
      .skill-menu.pill-menu--minimized:focus-within :deep(.skills-length) {
        visibility: visible;
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
      this.args.skills?.map((skill: Skill) => ({
        not: { eq: { id: skill.card.id } },
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

  @action attachSkill(card: CardDef) {
    this.args.onChooseCard?.(card as SkillCard);
  }
}
