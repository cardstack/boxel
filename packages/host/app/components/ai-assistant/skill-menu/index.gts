import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { Button } from '@cardstack/boxel-ui/components';

import { skillCardRef } from '@cardstack/runtime-common';
import { chooseCard } from '@cardstack/runtime-common';

import CardPill from '@cardstack/host/components/card-pill';
import PillMenu from '@cardstack/host/components/pill-menu';

import { RoomSkill } from '@cardstack/host/resources/room';

interface Signature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    skills: RoomSkill[];
    onExpand?: () => void;
    onCollapse?: () => void;
    onChooseCard?: (cardId: string) => Promise<unknown>;
    onUpdateSkillIsActive?: (isActive: boolean, skillCardId: string) => void;
  };
}

export default class AiAssistantSkillMenu extends Component<Signature> {
  <template>
    <PillMenu
      class='skill-menu'
      @onExpand={{fn this.setExpanded true}}
      @onCollapse={{fn this.setExpanded false}}
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
      <:content>
        <ul class='skill-list'>
          {{#each @skills key='cardId' as |skill|}}
            <li>
              <CardPill
                @cardId={{skill.cardId}}
                @onToggle={{fn this.toggleSkill skill}}
                @isEnabled={{skill.isActive}}
                @urlForRealmLookup={{this.urlForRealmLookup skill}}
                data-test-pill-menu-item={{skill.cardId}}
              />
            </li>
          {{/each}}
        </ul>
      </:content>
      <:footer>
        <Button
          class='attach-button'
          @kind='primary'
          {{on 'click' this.attachSkillCard}}
          @disabled={{this.doAttachSkillCard.isRunning}}
          @loading={{this.isAttachingSkill}}
          data-test-pill-menu-add-button
        >
          {{#if this.isAttachingSkill}}
            Adding Skill
          {{else}}
            Choose a Skill to add
          {{/if}}
        </Button>
      </:footer>
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
      .skill-list {
        display: grid;
        gap: var(--boxel-sp-xs);
        list-style-type: none;
        padding: 0;
        margin: 0;
        overflow-y: auto;
      }
      .skill-list :deep(.card-pill) {
        --pill-gap: var(--boxel-sp-xxxs);
        display: inline-grid;
        grid-template-columns: auto 1fr auto;
        width: 100%;
      }
      .skill-list :deep(.card-content) {
        max-width: initial;
        font: 600 var(--boxel-font-xs);
      }
      .attach-button {
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-border: 1px solid var(--boxel-400);
        --boxel-button-color: var(--boxel-dark);
        border-radius: var(--boxel-border-radius);

        padding: var(--boxel-sp-4xs) var(--boxel-sp-xxxs);
        gap: var(--boxel-sp-xs);
        background: none;
        width: 100%;
      }
      .attach-button:hover:not(:disabled),
      .attach-button:focus:not(:disabled) {
        --icon-color: var(--boxel-600);
        color: var(--boxel-600);
        background: none;
        box-shadow: none;
      }
      .attach-button:disabled {
        --boxel-button-text-color: var(--boxel-300);
        --boxel-button-border: 1px solid var(--boxel-300);
      }
      .attach-button > :deep(svg > path) {
        stroke: none;
      }
    </style>
  </template>

  @tracked private isExpanded = false;
  @tracked private isAttachingSkill = false;

  private urlForRealmLookup(skill: RoomSkill) {
    return skill.fileDef.sourceUrl;
  }

  @action
  private setExpanded(isExpanded: boolean) {
    this.isExpanded = isExpanded;
    if (isExpanded) {
      this.args.onExpand?.();
    } else {
      this.args.onCollapse?.();
    }
  }

  private get headerText() {
    if (this.isExpanded) {
      return `Skills: ${this.activeSkills.length} of ${this.args.skills.length} active`;
    }
    return `Skills ${this.activeSkills.length}`;
  }

  private get activeSkills() {
    return this.args.skills?.filter((skill) => skill.isActive) ?? [];
  }

  @action
  private attachSkillCard() {
    this.doAttachSkillCard.perform();
  }

  private doAttachSkillCard = restartableTask(async () => {
    let selectedCardIds =
      this.args.skills?.map((skill: RoomSkill) => ({
        not: { eq: { id: skill.cardId } },
      })) ?? [];
    // query for only displaying skill cards that are not already selected
    let query = {
      filter: {
        every: [{ type: skillCardRef }, ...selectedCardIds],
      },
    };
    let cardId = await chooseCard(query);
    if (cardId) {
      try {
        this.isAttachingSkill = true;
        await this.args.onChooseCard?.(cardId);
      } finally {
        this.isAttachingSkill = false;
      }
    }
  });

  @action
  private toggleSkill(skill: RoomSkill) {
    this.args.onUpdateSkillIsActive?.(!skill.isActive, skill.fileDef.sourceUrl);
  }
}
