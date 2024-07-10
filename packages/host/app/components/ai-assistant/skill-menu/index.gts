import { action } from '@ember/object';
import Component from '@glimmer/component';

import { eq } from '@cardstack/boxel-ui/helpers';

import { skillCardRef, type Query } from '@cardstack/runtime-common';

import PillMenu from '@cardstack/host/components/pill-menu';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type {
  SkillCard,
  SkillField,
} from 'https://cardstack.com/base/skill-card';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    skills: SkillField[];
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
        background-image: url('./robot-head@2x.webp');
        background-position: left center;
        background-repeat: no-repeat;
        background-size: contain;
        flex-shrink: 0;
      }
    </style>
  </template>

  private get query(): Query {
    let selectedCardIds = this.args.skills?.map((skill: SkillField) => ({
      not: { eq: { id: skill.card.id } },
    }));
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
