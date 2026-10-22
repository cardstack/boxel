import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, task, timeout } from 'ember-concurrency';

import { Button, ProgressBar } from '@cardstack/boxel-ui/components';
import { cn, not } from '@cardstack/boxel-ui/helpers';
import { CheckMark } from '@cardstack/boxel-ui/icons';

import { logger } from '@cardstack/runtime-common';

import { publishedRealmURLsFromInfo } from '@cardstack/host/lib/utils';
import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentCardsService from '@cardstack/host/services/recent-cards-service';

const log = logger('component:workspace-chooser/get-started');

const COPIED_FEEDBACK_MS = 2000;

export const AGENT_SETUP_COMMAND =
  'npm install -g @cardstack/boxel-cli && boxel profile add';

interface Step {
  id: 'open-card' | 'ask-ai' | 'publish' | 'agent';
  title: string;
  hint: string;
  done: boolean;
}

interface Signature {
  Element: HTMLElement;
}

// The dashboard's onboarding checklist. Every tick comes from something the
// user has actually done, read from state host already keeps, so the list
// can't drift from reality. It folds to one line once the user is under way
// and goes away when every step is done or the user dismisses it.
export default class GetStarted extends Component<Signature> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;
  @service declare private recentCardsService: RecentCardsService;

  @tracked private isExpanded = false;
  @tracked private copiedJustNow = false;

  private get steps(): Step[] {
    let dashboard = this.matrixService.dashboardState;
    return [
      {
        id: 'open-card',
        title: 'Open a card in a workspace',
        hint: 'Cards hold your data, documents and apps.',
        done: this.recentCardsService.recentCards.length > 0,
      },
      {
        id: 'ask-ai',
        title: 'Ask Boxel AI to build something',
        hint: 'It can make your first cards from a sentence.',
        done: this.aiAssistantPanelService.aiSessionRooms.length > 0,
      },
      {
        id: 'publish',
        title: 'Put a workspace on the web',
        hint: 'Publish from a workspace’s menu to share it at its own address.',
        done: this.realmServer.userRealmIdentifiers.some(
          (url) => publishedRealmURLsFromInfo(this.realm.info(url)).length > 0,
        ),
      },
      {
        id: 'agent',
        title: 'Connect your own agent',
        hint: 'Claude Code or Codex can work on your workspaces from a terminal.',
        done: Boolean(dashboard.agentCommandCopied),
      },
    ];
  }

  private get doneCount() {
    return this.steps.filter((step) => step.done).length;
  }

  private get nextStep() {
    return this.steps.find((step) => !step.done);
  }

  private get isVisible() {
    return (
      !this.matrixService.dashboardState.onboardingDismissed &&
      this.nextStep !== undefined
    );
  }

  // A brand-new account sees the steps; once one is done the panel folds to
  // a single line until the user asks for the rest.
  private get showSteps() {
    return this.isExpanded || this.doneCount === 0;
  }

  @action private toggleExpanded() {
    this.isExpanded = !this.isExpanded;
  }

  private dismissTask = task(async () => {
    try {
      await this.matrixService.updateDashboardState({
        onboardingDismissed: true,
      });
    } catch (error) {
      log.warn(`dismissing Get started failed: ${error}`);
    }
  });

  private agentSetupCommand = AGENT_SETUP_COMMAND;

  // A copy the browser refuses (no clipboard permission, an unfocused page)
  // leaves the step as it was rather than raising.
  private copyAgentCommandTask = restartableTask(async () => {
    try {
      await navigator.clipboard.writeText(this.agentSetupCommand);
      this.copiedJustNow = true;
      if (!this.matrixService.dashboardState.agentCommandCopied) {
        await this.matrixService.updateDashboardState({
          agentCommandCopied: true,
        });
      }
    } catch (error) {
      log.warn(`copying the agent setup command failed: ${error}`);
    }
    await timeout(COPIED_FEEDBACK_MS);
    this.copiedJustNow = false;
  });

  @action private async openFirstWorkspace() {
    let [first] = this.realmServer.userRealmIdentifiers;
    if (first) {
      await this.operatorModeStateService.openWorkspace(first);
    }
  }

  @action private async askBoxelAi() {
    await this.aiAssistantPanelService.openPanel();
    await this.aiAssistantPanelService.createNewSession();
  }

  <template>
    {{#if this.isVisible}}
      <section
        class='get-started'
        aria-labelledby='get-started-title'
        data-theme='dark'
        data-test-get-started
        ...attributes
      >
        <header class='header'>
          <h2 id='get-started-title' class='title'>Get started</h2>
          <ProgressBar
            class='progress'
            @value={{this.doneCount}}
            @max={{this.steps.length}}
          />
          <span class='count' data-test-get-started-count>
            {{this.doneCount}}
            of
            {{this.steps.length}}
            done
            {{#if (not this.showSteps)}}
              {{#if this.nextStep}}
                · Next:
                {{this.nextStep.title}}
              {{/if}}
            {{/if}}
          </span>
          <div class='header-actions'>
            {{#if this.doneCount}}
              <Button
                @kind={{if this.isExpanded 'secondary' 'primary'}}
                @size='small'
                {{on 'click' this.toggleExpanded}}
                aria-expanded={{if this.showSteps 'true' 'false'}}
                aria-controls='get-started-steps'
                data-test-get-started-toggle
              >
                {{if this.isExpanded 'Hide steps' 'Continue'}}
              </Button>
            {{/if}}
            <Button
              @kind='secondary'
              @size='small'
              @disabled={{this.dismissTask.isRunning}}
              {{on 'click' this.dismissTask.perform}}
              data-test-get-started-dismiss
            >
              Dismiss
            </Button>
          </div>
        </header>

        {{#if this.showSteps}}
          <ol id='get-started-steps' class='steps'>
            {{#each this.steps as |step|}}
              <li
                class={{cn 'step' is-done=step.done}}
                data-test-get-started-step={{step.id}}
                data-test-get-started-step-done={{step.done}}
              >
                <span class='tick' aria-hidden='true'>
                  {{#if step.done}}
                    <CheckMark width='12' height='12' />
                  {{/if}}
                </span>
                <span class='step-text'>
                  <span class='step-title'>
                    {{step.title}}
                    {{#if step.done}}
                      <span class='visually-hidden'>(done)</span>
                    {{/if}}
                  </span>
                  <span class='step-hint'>{{step.hint}}</span>
                  {{#if (isAgentStep step)}}
                    {{#unless step.done}}
                      <span class='command'>
                        <code
                          class='command-text'
                        >{{this.agentSetupCommand}}</code>
                        <Button
                          @kind='primary'
                          @size='small'
                          {{on 'click' this.copyAgentCommandTask.perform}}
                          data-test-get-started-copy-command
                        >
                          {{if this.copiedJustNow 'Copied' 'Copy'}}
                        </Button>
                      </span>
                    {{/unless}}
                  {{/if}}
                </span>
                {{#unless step.done}}
                  {{#if (isOpenCardStep step)}}
                    <Button
                      class='step-action'
                      @size='small'
                      {{on 'click' this.openFirstWorkspace}}
                      data-test-get-started-action={{step.id}}
                    >Open a workspace</Button>
                  {{else if (isAskAiStep step)}}
                    <Button
                      class='step-action'
                      @size='small'
                      {{on 'click' this.askBoxelAi}}
                      data-test-get-started-action={{step.id}}
                    >Ask Boxel AI</Button>
                  {{/if}}
                {{/unless}}
              </li>
            {{/each}}
          </ol>
        {{/if}}
      </section>
    {{/if}}

    <style scoped>
      .get-started {
        width: 100%;
        max-width: 60rem;
        box-sizing: border-box;
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        border-radius: var(--boxel-border-radius-xl);
        border: 1px solid var(--border);
        background-color: var(--card);
        color: var(--card-foreground);
      }
      .header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs) var(--boxel-sp);
      }
      .title {
        margin: 0;
        font-size: var(--boxel-font-size);
        font-weight: 600;
      }
      .progress {
        --boxel-progress-bar-background-color: var(--muted);
        --boxel-progress-bar-fill-color: var(--primary);
        width: 8rem;
      }
      .count {
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
      }
      .header-actions {
        display: flex;
        gap: var(--boxel-sp-xs);
        margin-left: auto;
      }
      .steps {
        list-style: none;
        margin: var(--boxel-sp-sm) 0 0;
        padding: 0;
      }
      .step {
        display: grid;
        grid-template-columns: 1.625rem minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding-block: var(--boxel-sp-sm);
        border-top: 1px solid var(--border);
      }
      .tick {
        width: 1.625rem;
        height: 1.625rem;
        box-sizing: border-box;
        border-radius: 50%;
        border: 1.5px solid var(--muted-foreground);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--primary-foreground);
        --icon-color: var(--primary-foreground);
      }
      .step.is-done .tick {
        background-color: var(--primary);
        border-color: var(--primary);
      }
      .step-text {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-6xs);
        min-width: 0;
      }
      .step-title {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .step.is-done .step-title {
        color: var(--muted-foreground);
        font-weight: 500;
      }
      .step-hint {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .command {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-top: var(--boxel-sp-xs);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-5xs) var(--boxel-sp-5xs)
          var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        border: 1px solid var(--border);
        background-color: var(--background);
      }
      .command-text {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      @media (max-width: 30rem) {
        .get-started {
          padding: var(--boxel-sp-sm);
        }
        .header-actions {
          margin-left: 0;
        }
        .step {
          grid-template-columns: 1.625rem minmax(0, 1fr);
        }
        .step-action {
          grid-column: 2;
          justify-self: start;
        }
      }
    </style>
  </template>
}

const isAgentStep = (step: Step) => step.id === 'agent';
const isOpenCardStep = (step: Step) => step.id === 'open-card';
const isAskAiStep = (step: Step) => step.id === 'ask-ai';
