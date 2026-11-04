import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import Check from '@cardstack/boxel-icons/check';
import ChevronDown from '@cardstack/boxel-icons/chevron-down';
import ChevronUp from '@cardstack/boxel-icons/chevron-up';
import { Button } from '@cardstack/pretui/components/button';
import { IconButton } from '@cardstack/pretui/components/icon-button';
import { ProgressBar } from '@cardstack/pretui/components/progress-bar';
import { VisuallyHidden } from '@cardstack/pretui/components/visually-hidden';
import { didCancel, dropTask, task, timeout } from 'ember-concurrency';
import { modifier } from 'ember-modifier';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import { logger } from '@cardstack/runtime-common';

import { isHostedRealm } from '@cardstack/host/lib/workspace-list';
import { NEW_SESSION_NAME } from '@cardstack/host/services/ai-assistant-panel-service';
import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentCardsService from '@cardstack/host/services/recent-cards-service';

import { AGENT_KINDS, usesCodingAgent } from './agent-kinds';

const log = logger('component:dashboard/get-started');

const AUTO_DISMISS_RETRY_DELAYS = [5_000, 30_000];

type StepId = 'open-card' | 'ask-ai' | 'publish' | 'agent';

interface Step {
  id: StepId;
  title: string;
  hint: string;
  done: boolean;
}

// What the page's own Get started button needs, yielded to the block that
// renders the page's header.
export interface GetStartedToggle {
  // Whether the button shows: the steps' ticks have been read, one is
  // still to do, and the list hasn't been dismissed.
  isReady: boolean;
  isOpen: boolean;
  panelId: string;
  toggle: () => void;
}

interface Signature {
  Element: HTMLElement;
  Args: {
    // Scrolls the dashboard to its Agents section.
    showAgents: () => void;
  };
  Blocks: {
    // The page's header, which holds the button that opens the list. The
    // list renders right after it.
    head: [GetStartedToggle];
  };
}

// The dashboard's onboarding checklist. Every tick comes from something the
// user has actually done, read from state the host already keeps, so the list
// can't drift from what happened. A button in the page's header opens and
// closes it; it opens by itself for someone who has done no step. Dismissing
// it hides both for good.
export default class GetStarted extends Component<Signature> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;
  @service declare private recentCardsService: RecentCardsService;

  @tracked private isOpen = false;
  // The icon button folds the open list to its progress line.
  @tracked private isExpanded = true;
  // Just dismissed: a note stands in for the list, with Undo.
  @tracked private isJustDismissed = false;
  // Dismiss or Undo held focus and is gone, so the control that
  // replaces it takes it.
  private focusNext: 'undo' | 'dismiss' | undefined;

  private panelId = `${guidFor(this)}-panel`;
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
  // Whether it opens by itself is decided here, once, so doing a first step
  // while it is open doesn't close it.
  private loadTask = task(async () => {
    try {
      await this.aiAssistantPanelService.waitForSessionRooms();
    } finally {
      this.isOpen = this.doneCount === 0 && !this.isDismissed;
    }
  });

  // A failed wait still shows the list, with whatever ticks can be read,
  // rather than hiding it for the rest of the session.
  private get isLoaded() {
    return Boolean(this.loadTask.lastSuccessful || this.loadTask.lastErrored);
  }

  // Read many times a render; aiSessionRooms walks and sorts every room.
  @cached
  private get steps(): Step[] {
    return [
      {
        id: 'open-card',
        title: 'Open a card in a workspace',
        hint: 'Cards hold your data, documents and apps.',
        done: this.recentCardsService.recentCards.length > 0,
      },
      this.buildStep,
      {
        id: 'publish',
        title: 'Put a workspace on the web',
        hint: 'Publish one from its menu to share it at its own address.',
        done: this.realmServer.userRealmIdentifiers.some((url) =>
          isHostedRealm(this.realm.info(url)),
        ),
      },
    ];
  }

  // The user builds with Boxel AI Assistant or with their own agent, not
  // both, so the step follows the one they've taken up.
  private get buildStep(): Step {
    let { agentSetup } = this.matrixService.dashboardState;
    if (usesCodingAgent(this.matrixService.dashboardAgent, agentSetup)) {
      return {
        id: 'agent',
        title: 'Connect your own agent',
        hint: 'Claude Code or Codex can build in your workspaces through the Boxel plugin.',
        // Only listed agents: progress kept for one no longer offered
        // doesn't count.
        done: AGENT_KINDS.some(({ id }) => (agentSetup?.[id] ?? 0) > 0),
      };
    }
    return {
      id: 'ask-ai',
      title: 'Ask Boxel AI Assistant to build something',
      hint: 'It can make your first cards from a sentence.',
      // Opening the panel makes an empty session, so only one with a
      // message has been asked. The sync's first pass brings only each
      // session's newest event, often the bot's rename rather than a
      // message, so a renamed session counts too.
      done: this.aiAssistantPanelService.aiSessionRooms.some(
        (session) =>
          Boolean(session.lastMessage) || session.name !== NEW_SESSION_NAME,
      ),
    };
  }

  private get doneCount() {
    return this.steps.filter((step) => step.done).length;
  }

  private get isDismissed() {
    return Boolean(this.matrixService.dashboardState.onboardingDismissed);
  }

  // Opening from the header always shows the steps.
  @action private toggle() {
    this.isOpen = !this.isOpen;
    this.isExpanded = true;
  }

  @action private toggleExpanded() {
    this.isExpanded = !this.isExpanded;
  }

  private get nextStep() {
    return this.steps.find((step) => !step.done);
  }

  // Dismissed, or with every step done, neither the button nor the list
  // shows.
  private get isAvailable() {
    return this.isLoaded && !this.isDismissed && this.nextStep !== undefined;
  }

  // Finishing every step dismisses it, so a step that later reads as undone
  // (recent cards are kept per browser) doesn't bring it back.
  private get isFinished() {
    return this.isLoaded && !this.isDismissed && this.nextStep === undefined;
  }

  private get toggleState(): GetStartedToggle {
    return {
      isReady: this.isAvailable,
      isOpen: this.isAvailable && this.isOpen,
      panelId: this.panelId,
      toggle: this.toggle,
    };
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

  private focusIfNext = modifier(
    (element: HTMLElement, [control]: ['undo' | 'dismiss']) => {
      if (this.focusNext === control) {
        this.focusNext = undefined;
        element.focus();
      }
    },
  );

  // Hides the list and the header's button for good, short of Undo.
  private dismissTask = dropTask(async () => {
    if (!(await this.saveDismissal())) {
      return;
    }
    this.focusNext = 'undo';
    this.isOpen = false;
    this.isJustDismissed = true;
  });

  // Opened before the write, so the button comes back already open rather
  // than in its closed look for the moment the write takes.
  private undoDismissTask = dropTask(async () => {
    this.focusNext = 'dismiss';
    this.isExpanded = true;
    this.isOpen = true;
    try {
      await this.matrixService.updateDashboardState({
        onboardingDismissed: false,
      });
    } catch (error) {
      log.warn(`undoing the dismissal of Get started failed: ${error}`);
      this.focusNext = undefined;
      this.isOpen = false;
      return;
    }
    this.isJustDismissed = false;
  });

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
    {{yield this.toggleState to='head'}}
    {{#if this.toggleState.isOpen}}
      <section
        class='get-started'
        id={{this.panelId}}
        aria-labelledby={{this.titleId}}
        data-test-get-started
        ...attributes
      >
        <div class='get-started-body'>
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
              {{#unless this.isExpanded}}
                {{#if this.nextStep}}
                  · Next:
                  {{this.nextStep.title}}
                {{/if}}
              {{/unless}}
            </p>
            <Button
              class='get-started-dismiss'
              @tone='danger'
              @appearance='link'
              @size='s'
              @busy={{this.dismissTask.isRunning}}
              {{on 'click' this.dismissTask.perform}}
              {{this.focusIfNext 'dismiss'}}
              data-test-get-started-dismiss
            >
              Dismiss
            </Button>
            {{! The minimize button sits at the far end. Its tooltip wraps it,
                so this wrapper is what the layout places. }}
            <div class='get-started-actions'>
              <IconButton
                @icon={{if this.isExpanded ChevronUp ChevronDown}}
                @label={{if this.isExpanded 'Minimize steps' 'Expand steps'}}
                @tooltip={{if this.isExpanded 'Minimize steps' 'Expand steps'}}
                @appearance='plain'
                @size='s'
                aria-expanded={{if this.isExpanded 'true' 'false'}}
                aria-controls={{if this.isExpanded this.stepsId}}
                {{on 'click' this.toggleExpanded}}
                data-test-get-started-toggle
              />
            </div>
          </header>

          {{#if this.isExpanded}}
            <ol class='get-started-steps' id={{this.stepsId}}>
              {{#each this.steps key='id' as |step|}}
                <li
                  class={{cn 'get-started-step' is-done=step.done}}
                  data-test-get-started-step={{step.id}}
                  data-test-get-started-step-done={{if
                    step.done
                    'true'
                    'false'
                  }}
                >
                  <span class='tick' aria-hidden='true'>
                    {{#if step.done}}
                      <Check width='14' height='14' stroke-width='3' />
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
                      >Ask Boxel AI Assistant</Button>
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
        </div>
      </section>
    {{else if this.isJustDismissed}}
      <div class='get-started-dismissed' data-test-get-started-dismissed>
        <p class='dismissed-note' id={{this.dismissedNoteId}}>Get started won’t
          show again.</p>
        <Button
          @appearance='link'
          @size='s'
          @busy={{this.undoDismissTask.isRunning}}
          aria-describedby={{this.dismissedNoteId}}
          {{on 'click' this.undoDismissTask.perform}}
          {{this.focusIfNext 'undo'}}
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
        margin-inline-start: auto;
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
        font-style: italic;
      }
      /* Narrow, the box stacks: the title row with Dismiss and the
         minimize button, the progress bar across the box, the count, then
         the steps. The header's items join the body's grid for that, in
         their DOM order so Tab follows what's on screen. */
      @container get-started (max-width: 30rem) {
        .get-started-body {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto;
          grid-template-areas:
            'title dismiss actions'
            'progress progress progress'
            'count count count'
            'steps steps steps';
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .get-started-head {
          display: contents;
        }
        .get-started-steps {
          grid-area: steps;
        }
        .get-started-title {
          grid-area: title;
        }
        .get-started-actions {
          grid-area: actions;
        }
        .get-started-progress {
          grid-area: progress;
          width: 100%;
        }
        .get-started-count {
          grid-area: count;
        }
        .get-started-dismiss {
          grid-area: dismiss;
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
