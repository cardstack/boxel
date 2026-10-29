import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import Check from '@cardstack/boxel-icons/check';
import Plus from '@cardstack/boxel-icons/plus';
import { Button } from '@cardstack/pretui/components/button';
import { VisuallyHidden } from '@cardstack/pretui/components/visually-hidden';

import { eq } from '@cardstack/boxel-ui/helpers';

import { logger } from '@cardstack/runtime-common';

import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

import { AGENT_KINDS, agentKindFor, type AgentKind } from './agent-kinds';
import AgentMark from './agent-mark';

import type { SectionFlyoutSignature } from './sections';

const log = logger('component:dashboard/agents-flyout');

// Enough to pick up where the user left off; the panel lists the rest.
const RECENT_SESSION_COUNT = 3;

// The Agents entry's flyout: the agent picker, which shows the Agents section
// with the picked agent's setup, and the latest Boxel AI sessions with a way
// to start a new one.
export default class AgentsFlyout extends Component<SectionFlyoutSignature> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private matrixService: MatrixService;

  private agentKinds = AGENT_KINDS;

  private sessionsHeadId = `${guidFor(this)}-sessions`;

  private get pickedId() {
    return agentKindFor(this.matrixService.dashboardState.agent).id;
  }

  private get recentSessions() {
    return this.aiAssistantPanelService.aiSessionRooms.slice(
      0,
      RECENT_SESSION_COUNT,
    );
  }

  @action private async pickAgent(kind: AgentKind) {
    this.args.close();
    this.args.showSection();
    try {
      await this.matrixService.updateDashboardState({ agent: kind.id });
    } catch (error) {
      // The section still shows; it keeps its previous pick.
      log.warn(`saving the picked agent failed: ${error}`);
    }
  }

  @action private async openSession(roomId: string) {
    this.args.close();
    this.aiAssistantPanelService.enterRoom(roomId);
    await this.aiAssistantPanelService.openPanel();
  }

  @action private async newSession() {
    this.args.close();
    await this.aiAssistantPanelService.openPanel();
    await this.aiAssistantPanelService.createNewSession();
  }

  <template>
    <header class='flyout-header'>
      <span class='flyout-title' id={{@titleId}}>Agents</span>
      <span class='flyout-hint'>Build with the agent you use</span>
    </header>
    {{#each this.agentKinds key='id' as |kind|}}
      <Button
        class='flyout-row'
        @appearance='plain'
        {{on 'click' (fn this.pickAgent kind)}}
        data-test-section-rail-agent={{kind.id}}
      >
        <span class='row-content'>
          <AgentMark @kind={{kind}} @size='small' />
          <span class='row-title'>{{kind.label}}</span>
          {{#if (eq this.pickedId kind.id)}}
            <Check
              class='row-picked'
              width='14'
              height='14'
              aria-hidden='true'
            />
            <VisuallyHidden>(picked)</VisuallyHidden>
          {{else}}
            <span class='row-meta'>{{kind.hint}}</span>
          {{/if}}
        </span>
      </Button>
    {{/each}}

    <div role='group' aria-labelledby={{this.sessionsHeadId}}>
      <span class='flyout-subhead' id={{this.sessionsHeadId}}>Boxel AI sessions</span>
      {{#each this.recentSessions key='roomId' as |session|}}
        <Button
          class='flyout-row'
          @appearance='plain'
          {{on 'click' (fn this.openSession session.roomId)}}
          data-test-section-rail-ai-session={{session.roomId}}
        >
          <span class='row-content'>
            <span class='row-title'>{{session.name}}</span>
          </span>
        </Button>
      {{/each}}
      <Button
        class='flyout-row'
        @appearance='plain'
        {{on 'click' this.newSession}}
        data-test-section-rail-ai-new-session
      >
        <span class='row-content'>
          <Plus width='16' height='16' aria-hidden='true' />
          <span class='row-title'>New session</span>
        </span>
      </Button>
    </div>

    <style scoped>
      .flyout-header {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-6xs);
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs) var(--boxel-sp-xs);
      }
      .flyout-title {
        font-size: var(--boxel-font-size);
        font-weight: 700;
      }
      .flyout-hint {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .flyout-subhead {
        display: block;
        padding: var(--boxel-sp-sm) var(--boxel-sp-xs) var(--boxel-sp-4xs);
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .flyout-row {
        --pretui-button-h: 2.5rem;
        --pretui-button-px: var(--boxel-sp-xs);
        --pretui-button-radius: var(--boxel-border-radius-lg);
        justify-content: flex-start;
        width: 100%;
      }
      /* The panel's content width, less the row's padding and border, so a
         long session name truncates instead of widening the row. */
      .row-content {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        width: calc(
          var(--section-rail-flyout-content-width) - 2 * var(--boxel-sp-xs) -
            2px
        );
      }
      .row-title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-align: start;
        text-overflow: ellipsis;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .row-meta {
        flex: none;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .row-picked {
        flex: none;
        color: var(--boxel-highlight);
      }
    </style>
  </template>
}
