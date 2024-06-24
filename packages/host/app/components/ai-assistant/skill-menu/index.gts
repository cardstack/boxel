import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';
import { restartableTask } from 'ember-concurrency';

import { TrackedArray, TrackedObject } from 'tracked-built-ins';

import { AddButton } from '@cardstack/boxel-ui/components';
import { cn, not } from '@cardstack/boxel-ui/helpers';

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
    <div
      class={{cn 'skill-menu' skill-menu--minimized=(not this.isExpanded)}}
      {{onClickOutside this.closeMenu exceptSelector='.card-catalog-modal'}}
      ...attributes
    >
      <button {{on 'click' this.toggleMenu}} class='menu-toggle'>
        <div class='menu-title'>
          {{this.activeSkills.length}}
          <span class='maybe-hidden'>of
            {{this.skills.length}}
            Skills Active
          </span>
        </div>
        <div class='expand-label maybe-hidden'>
          {{if this.isExpanded 'Hide' 'Show'}}
        </div>
      </button>
      {{#if this.isExpanded}}
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
      {{/if}}
    </div>
    <style>
      .skill-menu {
        display: grid;
        max-height: 100%;
        width: 100%;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        color: var(--boxel-dark);
        font: 700 var(--boxel-font-sm);
        box-shadow: var(--boxel-box-shadow);
      }
      .skill-menu--minimized {
        width: 3.75rem;
        white-space: nowrap;
        transition: width 0.2s ease-in;
      }
      .skill-menu--minimized:hover {
        width: 100%;
      }
      .skill-menu--minimized .maybe-hidden {
        visibility: collapse;
        transition: visibility 0.2s ease-in;
      }
      .skill-menu--minimized:hover .maybe-hidden {
        visibility: visible;
      }
      .menu-toggle {
        width: 100%;
        min-height: 2.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background-color: var(--boxel-light);
        border-radius: inherit;
        margin: 0;
        padding: 0;
        font: inherit;
        letter-spacing: inherit;
        border: none;
        overflow: hidden;
      }
      .menu-toggle:focus-visible {
        outline-color: var(--boxel-highlight);
      }
      .menu-toggle:focus-visible .expand-label {
        color: var(--boxel-highlight);
      }
      .menu-title {
        padding-left: var(--boxel-sp-xs);
      }
      .expand-label {
        color: var(--boxel-450);
        text-transform: uppercase;
        min-height: auto;
        min-width: auto;
        padding: var(--boxel-sp-xs);
        font: 700 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .skill-list {
        display: grid;
        gap: var(--boxel-sp-xs);
        list-style-type: none;
        padding: var(--boxel-sp-xs);
        margin: 0;
        overflow-y: auto;
      }
      .skill-list:deep(.card-pill) {
        width: 100%;
      }
      .skill-list:deep(.card-content) {
        max-width: initial;
      }
      .attach-button {
        --icon-color: var(--boxel-highlight);
        width: max-content;
        padding: var(--boxel-sp-xs);
        background: none;
        border-radius: var(--boxel-border-radius-xl);
        color: var(--boxel-highlight);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        transition: color var(--boxel-transition);
      }
      .attach-button:hover:not(:disabled),
      .attach-button:focus:not(:disabled) {
        --icon-color: var(--boxel-highlight-hover);
        color: var(--boxel-highlight-hover);
        background: none;
        box-shadow: none;
      }
    </style>
  </template>

  @tracked skills: TrackedArray<Skill> = new TrackedArray();
  @tracked isExpanded = false;

  @action toggleMenu() {
    this.isExpanded = !this.isExpanded;
  }

  @action closeMenu() {
    this.isExpanded = false;
  }

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
    let selectedCards =
      this.skills?.map((skill: Skill) => ({
        not: { eq: { id: skill.card.id } },
      })) ?? [];
    // catalog only displays skill cards that are not already selected
    let card: SkillCard | undefined = await chooseCard({
      filter: { every: [{ type: skillCardRef }, ...selectedCards] },
    });
    return card;
  });
}
