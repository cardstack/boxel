import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import PillMenu from '@cardstack/host/components/pill-menu';
import type { PillMenuItem } from '@cardstack/host/components/pill-menu';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import botHeadIcon from './robot-head.webp';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    skills: PillMenuItem[];
    onChooseCard?: (card: CardDef) => void;
  };
}

export default class AiAssistantPillMenu extends Component<Signature> {
  <template>
    <PillMenu
      @headerIconURL={{botHeadIcon}}
      @headerAction={{this.closeMenu}}
      @items={{@skills}}
      @canAttachCard={{true}}
      @onChooseCard={{@onChooseCard}}
    >
      <:title>
        {{this.activeSkills.length}}
        <span class='maybe-hidden skills-length'>of
          {{@skills.length}}
          Skills Active
        </span>
      </:title>
      <:header-action>
        {{if this.isExpanded 'Hide' 'Show'}}
      </:header-action>
    </PillMenu>
    <style>
      .pill-menu {
        display: grid;
        max-height: 100%;
        width: 100%;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        color: var(--boxel-dark);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
        box-shadow: var(--boxel-box-shadow);
      }
      .menu-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .title {
        margin: 0;
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
      }
      .title-group {
        display: flex;
        flex-flow: row nowrap;
      }
      .header-icon {
        width: 20px;
        height: 18px;
        background-position: left center;
        background-repeat: no-repeat;
        background-size: contain;
        margin-right: var(--boxel-sp-xxxs);
      }
      .header-button {
        padding: var(--boxel-sp-xs);
        color: var(--boxel-450);
        font: 700 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
        text-transform: uppercase;
      }
    </style>
  </template>

  @tracked isExpanded = false;

  @action toggleMenu() {
    this.isExpanded = !this.isExpanded;
  }

  @action closeMenu() {
    this.isExpanded = false;
  }

  private get activeSkills() {
    return this.args.skills.filter((skill) => skill.isActive);
  }
}
