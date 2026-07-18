import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import pluralize from 'pluralize';

import { Button } from '@cardstack/boxel-ui/components';

import { baseRRI, chooseCard, skillCardRef } from '@cardstack/runtime-common';

import SkillToggle from '@cardstack/host/components/ai-assistant/skill-menu/skill-toggle';
import PillMenu from '@cardstack/host/components/pill-menu';

import type { RoomSkill } from '@cardstack/host/resources/room';

// A skill expressed as a markdown file is a `MarkdownDef` whose frontmatter
// declares `boxel.kind: skill`. One branch of the mixed chooser's base filter
// selects exactly those.
const markdownDefRef = {
  module: baseRRI('markdown-file-def'),
  name: 'MarkdownDef',
};

interface Signature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    skills: RoomSkill[];
    onExpand?: () => void;
    onCollapse?: () => void;
    onChooseCard?: (cardId: string) => Promise<unknown>;
    // Parallel to onChooseCard: attaches a skill expressed as a markdown file.
    onChooseSkillMarkdown?: (skillId: string) => Promise<unknown>;
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
              <SkillToggle
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
          @size='extra-small'
          {{on 'click' this.attachSkill}}
          @disabled={{this.doAttachSkill.isRunning}}
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
      .skill-menu {
        background-color: transparent;
        box-shadow: none;
      }
      .skill-list {
        display: grid;
        gap: var(--boxel-sp-xxxs);
        list-style-type: none;
        padding: 0;
        margin: 0;
        overflow-y: auto;
        max-height: 300px;

        scroll-timeline: --pill-menu-content-scroll-timeline;
      }

      .skill-list :deep(.card-content) {
        max-width: initial;
        font: 600 var(--boxel-font-xs);
      }
      .attach-button {
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-border: 1px solid var(--boxel-400);
        --boxel-button-color: var(--boxel-dark);
        --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-sm);
        --boxel-button-min-height: unset;

        gap: var(--boxel-sp-xs);
        background: none;
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
    return `${this.activeSkills.length} ${pluralize(
      'Skills',
      this.activeSkills.length,
    )}`;
  }

  private get activeSkills() {
    return this.args.skills?.filter((skill) => skill.isActive) ?? [];
  }

  @action
  private attachSkill() {
    this.doAttachSkill.perform();
  }

  // One chooser attaches either kind of skill: a Skill card or a skill-bearing
  // markdown file (a MarkdownDef with `boxel.kind: skill`). The mixed chooser
  // (`includeFiles`) surfaces both in a single list and tags each pick with its
  // kind, which routes the result to the matching attach callback.
  private doAttachSkill = restartableTask(async () => {
    // Exclude already-attached skills. The `not: { eq: { id } }` clauses are
    // built client-side from the menu's own skill list, so card skills are
    // excluded immediately; file skills are excluded once their rows carry
    // `id` in the search doc (Phase 1 reindex), and the feature ships without
    // waiting on that reindex.
    let exclusions =
      this.args.skills?.map((skill: RoomSkill) => ({
        not: { eq: { id: skill.cardId } },
      })) ?? [];
    let query = {
      filter: {
        every: [
          {
            any: [
              { type: skillCardRef },
              { on: markdownDefRef, eq: { kind: 'skill' } },
            ],
          },
          ...exclusions,
        ],
      },
    };
    let chosen = await chooseCard(query, { includeFiles: true });
    if (!chosen) {
      return;
    }
    try {
      this.isAttachingSkill = true;
      if (chosen.kind === 'file') {
        await this.args.onChooseSkillMarkdown?.(chosen.id);
      } else {
        await this.args.onChooseCard?.(chosen.id);
      }
    } finally {
      this.isAttachingSkill = false;
    }
  });

  @action
  private toggleSkill(skill: RoomSkill) {
    this.args.onUpdateSkillIsActive?.(!skill.isActive, skill.fileDef.sourceUrl);
  }
}
