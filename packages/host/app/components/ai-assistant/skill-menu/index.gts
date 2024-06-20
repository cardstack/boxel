import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { TrackedArray, TrackedObject } from 'tracked-built-ins';

import { AddButton } from '@cardstack/boxel-ui/components';

import { chooseCard, skillCardRef } from '@cardstack/runtime-common';

import CardPill from '@cardstack/host/components/card-pill';

import type { SkillCard } from 'https://cardstack.com/base/skill-card';

interface Signature {
  Element: HTMLDivElement;
  Args: {};
}

interface Skill {
  card: SkillCard;
  isActive: boolean;
}

export default class AiAssistantSkillMenu extends Component<Signature> {
  <template>
    <div class='skill-menu' ...attributes>
      <div>{{this.activeSkills.length}}
        of
        {{this.skills.length}}
        Skills Active</div>
      {{#if this.skills}}
        <ul class='skill-list'>
          {{#each this.skills as |skill|}}
            <li>
              <CardPill
                @card={{skill.card}}
                @onToggle={{fn this.toggleSkill skill}}
                @isEnabled={{skill.isActive}}
              />
            </li>
          {{/each}}
        </ul>
      {{/if}}
      <AddButton
        class='attach-button'
        @variant='pill'
        @iconWidth='15px'
        @iconHeight='15px'
        {{on 'click' this.attachSkillCard}}
        @disabled={{this.doAttachCard.isRunning}}
        data-test-choose-card-btn
      >
        Add Skill
      </AddButton>
    </div>
    <style>
      .skill-menu {
        width: 100%;
        display: grid;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        color: var(--boxel-dark);
        font: 700 var(--boxel-font-sm);
      }
      .skill-list {
        display: grid;
        gap: var(--boxel-sp-xs);
        list-style-type: none;
        padding: 0;
        margin: 0;
      }
      .skill-list:deep(.card-pill) {
        width: 100%;
      }
      .skill-list:deep(.card-content) {
        max-width: initial;
      }
      .attach-button {
        --icon-color: var(--boxel-highlight);
        display: inline-flex;
        width: max-content;
        color: var(--boxel-highlight);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        background-color: var(--boxel-light);
        padding-left: 0;
      }
      .attach-button:focus {
        outline: 0;
      }
      .attach-button:hover:not(:disabled),
      .attach-button:focus:not(:disabled) {
        --icon-color: var(--boxel-highlight-hover);
        background-color: var(--boxel-light);
        color: var(--boxel-highlight-hover);
        box-shadow: none;
      }
    </style>
  </template>

  @tracked skills: TrackedArray<Skill> = new TrackedArray();

  private get activeSkills() {
    return this.skills.filter((skill) => skill.isActive);
  }

  @action toggleSkill(skill: Skill) {
    skill.isActive = !skill.isActive;
  }

  @action
  private async attachSkillCard() {
    let card = await this.doAttachCard.perform();
    if (card) {
      this.skills.push(new TrackedObject({ card, isActive: true }));
    }
  }

  private doAttachCard = restartableTask(async () => {
    let card: SkillCard | undefined = await chooseCard({
      filter: { type: skillCardRef },
    });
    return card;
  });
}
