import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import Check from '@cardstack/boxel-icons/check';
import { Button } from '@cardstack/pretui/components/button';
import { ProgressBar } from '@cardstack/pretui/components/progress-bar';
import { VisuallyHidden } from '@cardstack/pretui/components/visually-hidden';
import { didCancel, dropTask, task, timeout } from 'ember-concurrency';
import { modifier } from 'ember-modifier';

import { cn, eq, not } from '@cardstack/boxel-ui/helpers';

import { logger } from '@cardstack/runtime-common';

import { isHostedRealm } from '@cardstack/host/lib/workspace-list';
import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentCardsService from '@cardstack/host/services/recent-cards-service';

import { AGENT_KINDS } from './agent-kinds';

const log = logger('component:dashboard/get-started');

const AUTO_DISMISS_RETRY_DELAYS = [5_000, 30_000];

type StepId = 'open-card' | 'ask-ai' | 'publish' | 'agent';

interface Step {
  id: StepId;
  title: string;
  hint: string;
  done: boolean;
}

interface Signature {
  Element: HTMLElement;
  Args: {
    // Scrolls the dashboard to its Agents section.
    showAgents: () => void;
  };
}

// The dashboard's onboarding checklist. Every tick comes from something the
// user has actually done, read from state the host already keeps, so the list
// can't drift from what happened. It folds to one line once a step is done,
// and goes away for good once every step is done or the user dismisses it.
export default class GetStarted extends Component<Signature> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;
  @service declare private recentCardsService: RecentCardsService;

  @tracked private isExpanded = false;
  // Set by the user's own dismissal, so it can be undone until they leave
  // the dashboard. Finishing every step dismisses it with no undo.
  @tracked private isJustDismissed = false;
  // The control that replaced the one just pressed, which takes focus once
  // it renders, since the pressed one is gone.
  private focusAfterToggle: 'undo' | 'dismiss' | undefined;

  private titleId = `${guidFor(this)}-title`;
  private stepsId = `${guidFor(this)}-steps`;
  private dismissedNoteId = `${guidFor(this)}-dismissed`;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.loadTask.perform().catch((error: unknown) => {
      if (!didCancel(error)) {
        log.warn(`waiting for Get started's signals failed: ${error}`);
      }
    });
  }

  // Shown only once every tick can be read, so a done step never flashes as
  // undone. Recent cards are read from local storage when their service is
  // made, so they need no wait. The rest have no loaded state of their own:
  // login reads the dashboard state, the realm list and its info before it
  // starts the sync, and the AI sessions are listed once the sync's first
  // pass is processed.
  private loadTask = task(async () => {
    await this.aiAssistantPanelService.waitForSessionRooms();
  });

  // A failed wait still shows the list, with whatever ticks can be read,
  // rather than hiding it for the rest of the session.
  private get isLoaded() {
    return Boolean(this.loadTask.lastSuccessful || this.loadTask.lastErrored);
  }

  // Read many times a render; aiSessionRooms walks and sorts every room.
  @cached
  private get steps(): Step[] {
    let { agentSetup } = this.matrixService.dashboardState;
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
        // Opening the panel makes an empty session, so only one with a
        // message has been asked.
        done: this.aiAssistantPanelService.aiSessionRooms.some((session) =>
          Boolean(session.lastMessage),
        ),
      },
      {
        id: 'publish',
        title: 'Put a workspace on the web',
        hint: 'Publish one from its menu to share it at its own address.',
        done: this.realmServer.userRealmIdentifiers.some((url) =>
          isHostedRealm(this.realm.info(url)),
        ),
      },
      {
        id: 'agent',
        title: 'Connect your own agent',
        hint: 'Claude Code and others build in your workspaces through the Boxel plugin.',
        // Only listed agents: progress kept for one no longer offered
        // doesn't count.
        done: AGENT_KINDS.some(({ id }) => (agentSetup?.[id] ?? 0) > 0),
      },
    ];
  }

  private get doneCount() {
    return this.steps.filter((step) => step.done).length;
  }

  private get nextStep() {
    return this.steps.find((step) => !step.done);
  }

  private get isDismissed() {
    return Boolean(this.matrixService.dashboardState.onboardingDismissed);
  }

  private get isShown() {
    return this.isLoaded && !this.isDismissed && this.nextStep !== undefined;
  }

  // Finishing every step dismisses it, so a step that later reads as undone
  // (recent cards are kept per browser) doesn't bring it back.
  private get isFinished() {
    return this.isLoaded && !this.isDismissed && this.nextStep === undefined;
  }

  // A new account sees the steps; once one is done the panel folds to a
  // single line until the user asks for the rest.
  private get showSteps() {
    return this.isExpanded || this.doneCount === 0;
  }

  @action private toggleExpanded() {
    this.isExpanded = !this.isExpanded;
  }

  // Runs when the finished state renders, not on every render: its element
  // is inserted once, and goes when the dismissal lands. Nothing runs it
  // again while it stays, so a failed write is retried here.
  private dismissWhenFinished = modifier(() => {
    this.autoDismissTask.perform();
  });

  private autoDismissTask = dropTask(async () => {
    for (let delay of [0, ...AUTO_DISMISS_RETRY_DELAYS]) {
      await timeout(delay);
      if (await this.saveDismissal()) {
        return;
      }
    }
  });

  private dismissTask = dropTask(async () => {
    if (await this.saveDismissal()) {
      this.focusAfterToggle = 'undo';
      this.isJustDismissed = true;
    }
  });

  private undoDismissTask = dropTask(async () => {
    try {
      await this.matrixService.updateDashboardState({
        onboardingDismissed: false,
      });
    } catch (error) {
      log.warn(`undoing the dismissal of Get started failed: ${error}`);
      return;
    }
    this.focusAfterToggle = 'dismiss';
    this.isJustDismissed = false;
  });

  private focusIfToggled = modifier(
    (element: HTMLElement, [control]: ['undo' | 'dismiss']) => {
      if (this.focusAfterToggle === control) {
        this.focusAfterToggle = undefined;
        element.focus();
      }
    },
  );

  private async saveDismissal() {
    try {
      await this.matrixService.updateDashboardState({
        onboardingDismissed: true,
      });
      return true;
    } catch (error) {
      log.warn(`dismissing Get started failed: ${error}`);
      return false;
    }
  }

  @action private async openFirstWorkspace() {
    let [first] = this.realmServer.userRealmIdentifiers;
    if (first) {
      await this.operatorModeStateService.openWorkspace(first);
    }
  }

  @action private async askBoxelAi() {
    await this.aiAssistantPanelService.openNewSession();
  }

  <template>
    {{#if this.isShown}}
      <section
        class='get-started'
        aria-labelledby={{this.titleId}}
        data-test-get-started
        ...attributes
      >
        <header class='get-started-head'>
          <h2 class='get-started-title' id={{this.titleId}}>Get started</h2>
          <ProgressBar
            class='get-started-progress'
            @value={{this.doneCount}}
            @max={{this.steps.length}}
            aria-labelledby={{this.titleId}}
          />
          <p class='get-started-count' data-test-get-started-count>
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
          </p>
          <div class='get-started-actions'>
            {{#if this.doneCount}}
              <Button
                @tone={{if this.isExpanded 'neutral' 'primary'}}
                @appearance={{if this.isExpanded 'outlined' 'accent'}}
                @size='s'
                aria-expanded={{if this.showSteps 'true' 'false'}}
                aria-controls={{if this.showSteps this.stepsId}}
                {{on 'click' this.toggleExpanded}}
                data-test-get-started-toggle
              >
                {{if this.isExpanded 'Hide steps' 'Continue'}}
              </Button>
            {{/if}}
            <Button
              @appearance='outlined'
              @size='s'
              @busy={{this.dismissTask.isRunning}}
              {{on 'click' this.dismissTask.perform}}
              {{this.focusIfToggled 'dismiss'}}
              data-test-get-started-dismiss
            >
              Dismiss
            </Button>
          </div>
        </header>

        {{#if this.showSteps}}
          <ol class='get-started-steps' id={{this.stepsId}}>
            {{#each this.steps key='id' as |step|}}
              <li
                class={{cn 'get-started-step' is-done=step.done}}
                data-test-get-started-step={{step.id}}
                data-test-get-started-step-done={{if step.done 'true' 'false'}}
              >
                <span class='tick' aria-hidden='true'>
                  {{#if step.done}}
                    <Check width='12' height='12' />
                  {{/if}}
                </span>
                <span class='step-words'>
                  <span class='step-title'>
                    {{step.title}}
                    {{#if step.done}}
                      <VisuallyHidden>(done)</VisuallyHidden>
                    {{/if}}
                  </span>
                  <span class='step-hint'>{{step.hint}}</span>
                </span>
                {{#unless step.done}}
                  {{#if (eq step.id 'open-card')}}
                    {{#if this.realmServer.userRealmIdentifiers.length}}
                      <Button
                        class='step-action'
                        @appearance='outlined'
                        @size='s'
                        {{on 'click' this.openFirstWorkspace}}
                        data-test-get-started-action={{step.id}}
                      >Open a workspace</Button>
                    {{/if}}
                  {{else if (eq step.id 'ask-ai')}}
                    <Button
                      class='step-action'
                      @appearance='outlined'
                      @size='s'
                      {{on 'click' this.askBoxelAi}}
                      data-test-get-started-action={{step.id}}
                    >Ask Boxel AI</Button>
                  {{else if (eq step.id 'agent')}}
                    <Button
                      class='step-action'
                      @appearance='outlined'
                      @size='s'
                      {{on 'click' @showAgents}}
                      data-test-get-started-action={{step.id}}
                    >Set up an agent</Button>
                  {{/if}}
                {{/unless}}
              </li>
            {{/each}}
          </ol>
        {{/if}}
      </section>
    {{else if this.isJustDismissed}}
      <div class='get-started-dismissed' data-test-get-started-dismissed>
        <p class='dismissed-note' id={{this.dismissedNoteId}}>Get started hidden</p>
        <Button
          @appearance='link'
          @size='s'
          @busy={{this.undoDismissTask.isRunning}}
          aria-describedby={{this.dismissedNoteId}}
          {{on 'click' this.undoDismissTask.perform}}
          {{this.focusIfToggled 'undo'}}
          data-test-get-started-undo-dismiss
        >
          Undo
        </Button>
      </div>
    {{else if this.isFinished}}
      <span hidden {{this.dismissWhenFinished}}></span>
    {{/if}}

    <style scoped>
      .get-started {
        --_get-started-max-width: 60rem;
        --_get-started-tick-size: 1.625rem;
        --_get-started-progress-width: 8rem;
        width: 100%;
        max-width: var(--_get-started-max-width);
        box-sizing: border-box;
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        border: 1px solid var(--boxel-light-10);
        border-radius: var(--boxel-border-radius-xl);
        background-color: var(--boxel-700);
        color: var(--foreground);
        container: get-started / inline-size;
      }
      .get-started-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs) var(--boxel-sp);
      }
      .get-started-title {
        margin: 0;
        font-size: var(--boxel-font-size);
        font-weight: 700;
      }
      .get-started-progress {
        width: var(--_get-started-progress-width);
      }
      .get-started-count {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
      }
      .get-started-actions {
        display: flex;
        gap: var(--boxel-sp-xs);
        margin-left: auto;
      }
      .get-started-steps {
        margin: var(--boxel-sp-sm) 0 0;
        padding: 0;
        list-style: none;
      }
      .get-started-step {
        display: grid;
        grid-template-columns: var(--_get-started-tick-size) minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding-block: var(--boxel-sp-sm);
        border-top: 1px solid var(--boxel-light-10);
      }
      .tick {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--_get-started-tick-size);
        height: var(--_get-started-tick-size);
        box-sizing: border-box;
        border: 1.5px solid var(--muted-foreground);
        border-radius: 50%;
      }
      .get-started-step.is-done .tick {
        border-color: var(--boxel-highlight);
        background-color: var(--boxel-highlight);
        color: var(--boxel-highlight-foreground);
      }
      .step-words {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-6xs);
        min-width: 0;
      }
      .step-title {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .get-started-step.is-done .step-title {
        color: var(--muted-foreground);
        font-weight: 500;
      }
      .step-hint {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .get-started-dismissed {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
        color: var(--muted-foreground);
      }
      .dismissed-note {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
      }
      @container get-started (max-width: 30rem) {
        .get-started-actions {
          margin-left: 0;
        }
        .get-started-step {
          grid-template-columns: var(--_get-started-tick-size) minmax(0, 1fr);
        }
        .step-action {
          grid-column: 2;
          justify-self: start;
        }
      }
    </style>
  </template>
}
