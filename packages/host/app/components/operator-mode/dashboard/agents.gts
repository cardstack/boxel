import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import Check from '@cardstack/boxel-icons/check';
import Copy from '@cardstack/boxel-icons/copy';
import Sparkles from '@cardstack/boxel-icons/sparkles';
import { Button } from '@cardstack/pretui/components/button';
import { NativeSelect } from '@cardstack/pretui/components/native-select';
import { ProgressBar } from '@cardstack/pretui/components/progress-bar';
import { RadioCard } from '@cardstack/pretui/components/radio-card';
import { VisuallyHidden } from '@cardstack/pretui/components/visually-hidden';
import { restartableTask, timeout } from 'ember-concurrency';

import { add, cn, eq } from '@cardstack/boxel-ui/helpers';

import { logger } from '@cardstack/runtime-common';

import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type NetworkService from '@cardstack/host/services/network';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  AGENT_KINDS,
  agentKindFor,
  setupStepsFor,
  type DashboardAgent,
} from './agent-kinds';
import AgentMark from './agent-mark';

const log = logger('component:dashboard/agents');

const COPIED_FEEDBACK_MS = 2000;

// Boxel AI Assistant needs no setup, so its card says how it works instead.
const HOW_BOXEL_AI_WORKS = [
  {
    title: 'Describe what you want',
    note: 'In your own words, from any workspace',
  },
  {
    title: 'Boxel AI builds it',
    note: 'Cards, fields and data, right in the workspace',
  },
  { title: 'Refine it in the chat', note: 'Ask for changes as you look' },
];

interface Signature {
  Element: HTMLElement;
}

// The Agents section's body: pick an agent, then set it up. A coding agent's
// steps are copied into a terminal or its own chat; Boxel AI Assistant, built
// in, gets a how-it-works card and a way to start. The pick and the setup
// progress are kept in the dashboard's account data, so the rail's flyout and
// Get started read the same state.
export default class Agents extends Component<Signature> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  // A step the user opened by hand; otherwise the next one to copy is open.
  // Both are kept with their agent, so a pick made anywhere starts the new
  // agent at its own next step.
  @tracked private opened: AgentStep | null = null;
  @tracked private copied: AgentStep | null = null;
  @tracked private pickedWorkspaceURL: string | undefined;

  private stepsId = `${guidFor(this)}-steps`;

  private agentOptions = AGENT_KINDS.map((kind) => ({
    value: kind.id,
    title: kind.label,
    description: kind.hint,
  }));

  private get kind() {
    return agentKindFor(this.matrixService.dashboardAgent);
  }

  private get openedStep() {
    return this.opened?.agent === this.kind.id ? this.opened.index : null;
  }

  private get copiedStep() {
    return this.copied?.agent === this.kind.id ? this.copied.index : null;
  }

  private get isBuiltIn() {
    return !this.kind.setup;
  }

  // Favorites first, since they're what the user works on, then the rest of
  // their own workspaces. Catalogs are left out: most users can't push there.
  @cached
  private get workspaceOptions() {
    let own = this.realmServer.userRealmIdentifiers as string[];
    let ownSet = new Set(own);
    let favorites = this.matrixService.workspaceFavorites.filter((url) =>
      ownSet.has(url),
    );
    return [...new Set([...favorites, ...own])].map((url) => ({
      value: url,
      label: this.realm.info(url).name,
    }));
  }

  private get workspaceURL() {
    let options = this.workspaceOptions;
    return (
      options.find(({ value }) => value === this.pickedWorkspaceURL)?.value ??
      options[0]?.value
    );
  }

  // The agent signs in to the realm's own address, not an identifier's
  // shorthand.
  @cached
  private get steps() {
    let id = this.workspaceURL;
    return setupStepsFor(this.kind, id ? this.toURL(id) : undefined);
  }

  private toURL(id: string) {
    try {
      return this.network.virtualNetwork.toURL(id).href;
    } catch {
      return id;
    }
  }

  // The stored count, held to this agent's list.
  private get copiedCount() {
    let copied = this.matrixService.dashboardState.agentSetup?.[this.kind.id];
    return Math.min(copied ?? 0, this.steps.length);
  }

  // Names the step, so a copy of another step inside the feedback window is
  // announced too.
  private get copiedMessage() {
    let index = this.copiedStep;
    return index === null ? '' : `Step ${index + 1} copied`;
  }

  private get openIndex() {
    return this.openedStep ?? Math.min(this.copiedCount, this.steps.length - 1);
  }

  private stepState = (index: number) =>
    index < this.copiedCount
      ? 'is-done'
      : index === this.copiedCount
        ? 'is-next'
        : 'is-later';

  private isCopied = (index: number) => index < this.copiedCount;

  @action private async pickAgent(value: string) {
    let kind = AGENT_KINDS.find(({ id }) => id === value);
    if (!kind) {
      return;
    }
    try {
      await this.matrixService.pickDashboardAgent(kind.id);
    } catch (error) {
      log.warn(`saving the picked agent failed: ${error}`);
    }
  }

  @action private pickWorkspace(url: string) {
    this.pickedWorkspaceURL = url;
  }

  // Closing the open step leaves none open (-1) until the user opens one.
  @action private toggleStep(index: number) {
    this.opened = {
      agent: this.kind.id,
      index: this.openIndex === index ? -1 : index,
    };
  }

  // The dashboard can't see the terminal or the agent's chat, so copying a
  // step is what counts as doing it. The count is computed from the stored
  // one, so a later step copied in another tab isn't wound back. A copy the
  // browser refuses (no clipboard permission, an unfocused page) leaves the
  // step as it was.
  private copyTask = restartableTask(async (index: number, text: string) => {
    let agent = this.kind.id;
    // The copied step stays open until the feedback ends, though the count
    // it raises moves the next step to copy.
    let pin = { agent, index };
    this.opened = pin;
    let copied = { agent, index };
    try {
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        log.warn(`copying setup step ${index + 1} failed: ${error}`);
        // The step stays open, as if opened by hand, for another try.
        this.opened = { agent, index };
        return;
      }
      this.copied = copied;
      this.saveProgress(agent, index);
      await timeout(COPIED_FEEDBACK_MS);
    } finally {
      // Also when a later copy cancels this one.
      if (this.copied === copied) {
        this.copied = null;
      }
      if (this.opened === pin) {
        this.opened = null;
      }
    }
  });

  // Not awaited by the copy, so the feedback lasts the same however slow the
  // save is.
  private saveProgress(agent: DashboardAgent, index: number) {
    this.matrixService
      .updateDashboardState((stored) => ({
        agentSetup: {
          [agent]: Math.max(stored.agentSetup?.[agent] ?? 0, index + 1),
        },
      }))
      .catch((error: unknown) => {
        log.warn(`saving setup progress failed: ${error}`);
      });
  }

  @action private async describeIt() {
    await this.aiAssistantPanelService.openNewSession();
  }

  <template>
    <div class='agents' data-test-agents ...attributes>
      <header class='pitch'>
        <h3 class='pitch-title'>Build with the agent you already pay for</h3>
        <p class='pitch-body'>
          Add the Boxel plugin to your coding agent and it builds right in your
          workspaces, or ask Boxel AI Assistant here.
        </p>
      </header>

      <RadioCard
        @options={{this.agentOptions}}
        @value={{this.kind.id}}
        @onValueChange={{this.pickAgent}}
        @orientation='horizontal'
        @label='Your agent'
        data-test-agent-picker
      >
        <:media as |option|>
          <AgentMark @kind={{agentKindFor option.value}} />
        </:media>
      </RadioCard>

      {{! The screencast of the picked agent takes the column before this
          panel, so the two read as watch it, then do it. }}
      <div class='agent-panel-row'>
        <section
          class='agent-panel'
          aria-labelledby={{concat this.stepsId '-title'}}
          data-test-agent-panel={{this.kind.id}}
        >
          <div class='panel-head'>
            <AgentMark @kind={{this.kind}} @size='small' />
            <h4
              class='panel-title'
              id={{concat this.stepsId '-title'}}
              data-test-agent-panel-title
            >
              {{if this.isBuiltIn 'Build with' 'Connect'}}
              {{this.kind.label}}
            </h4>
          </div>
          {{#if this.isBuiltIn}}
            <p class='panel-note'>Built into Boxel, with nothing to install.
              Uses credits.</p>
            <ol class='step-list'>
              {{#each HOW_BOXEL_AI_WORKS as |step index|}}
                <li class='step is-later'>
                  <span class='step-row'>
                    <span class='step-number' aria-hidden='true'>{{add
                        index
                        1
                      }}</span>
                    <span class='step-words'>
                      <span class='step-title'>{{step.title}}</span>
                      <span class='step-note'>{{step.note}}</span>
                    </span>
                  </span>
                </li>
              {{/each}}
            </ol>
            <Button
              class='describe-it'
              @tone='primary'
              @appearance='accent'
              {{on 'click' this.describeIt}}
              data-test-agent-describe-it
            >
              <Sparkles width='16' height='16' aria-hidden='true' />
              Describe it
            </Button>
          {{else}}
            <ProgressBar
              @value={{this.copiedCount}}
              @max={{this.steps.length}}
              @count={{concat
                this.copiedCount
                ' of '
                this.steps.length
                ' copied'
              }}
              @label='Setup'
              data-test-agent-setup-progress
            />
            <ol class='step-list' id={{this.stepsId}}>
              {{#each this.steps key='title' as |step index|}}
                {{#let (eq this.openIndex index) as |isOpen|}}
                  <li
                    class={{cn 'step' (this.stepState index)}}
                    data-test-agent-step={{add index 1}}
                    data-test-agent-step-copied={{if
                      (this.isCopied index)
                      'true'
                      'false'
                    }}
                  >
                    <Button
                      class='step-head'
                      @appearance='plain'
                      aria-expanded={{if isOpen 'true' 'false'}}
                      aria-controls={{if
                        isOpen
                        (concat this.stepsId '-' index)
                      }}
                      {{on 'click' (fn this.toggleStep index)}}
                      data-test-agent-step-head
                    >
                      <span class='step-number' aria-hidden='true'>
                        {{#if (this.isCopied index)}}
                          <Check width='14' height='14' />
                        {{else}}
                          {{add index 1}}
                        {{/if}}
                      </span>
                      <span class='step-words'>
                        <span class='step-title'>
                          {{step.title}}
                          {{#if (this.isCopied index)}}
                            <VisuallyHidden>(copied)</VisuallyHidden>
                          {{/if}}
                        </span>
                        <span class='step-note'>{{step.note}}</span>
                      </span>
                    </Button>
                    {{#if isOpen}}
                      <div
                        class='step-body'
                        id={{concat this.stepsId '-' index}}
                      >
                        {{#if step.isWorkspacePick}}
                          {{#if this.workspaceOptions.length}}
                            <NativeSelect
                              class='workspace-pick'
                              @options={{this.workspaceOptions}}
                              @value={{this.workspaceURL}}
                              @onValueChange={{this.pickWorkspace}}
                              @label='Workspace to open'
                              @size='s'
                              data-test-agent-workspace-pick
                            />
                          {{/if}}
                        {{/if}}
                        <div class='step-text'>
                          <code
                            class='step-code'
                            id={{concat this.stepsId '-' index '-text'}}
                            data-test-agent-step-text
                          >{{step.text}}</code>
                          <Button
                            class='copy'
                            @tone='primary'
                            @appearance='accent'
                            @size='s'
                            @shape='pill'
                            aria-describedby={{concat
                              this.stepsId
                              '-'
                              index
                              '-text'
                            }}
                            {{on
                              'click'
                              (fn this.copyTask.perform index step.text)
                            }}
                            data-test-agent-copy={{add index 1}}
                          >
                            {{#if (eq this.copiedStep index)}}
                              <Check
                                width='14'
                                height='14'
                                aria-hidden='true'
                              />
                              Copied
                            {{else}}
                              <Copy width='14' height='14' aria-hidden='true' />
                              Copy
                            {{/if}}
                          </Button>
                        </div>
                      </div>
                    {{/if}}
                  </li>
                {{/let}}
              {{/each}}
            </ol>
          {{/if}}
        </section>
      </div>
      {{! Rendered empty up front, so the copy is announced. }}
      <VisuallyHidden role='status'>
        {{this.copiedMessage}}
      </VisuallyHidden>
    </div>

    <style scoped>
      .agents {
        --_agents-panel-max-width: 40rem;
        --_agents-step-number-size: 1.75rem;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }

      .pitch {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-2xs);
        max-width: var(--_agents-panel-max-width);
      }
      /* Below the section heading in rank: the pitch never outshouts it. */
      .pitch-title {
        margin: 0;
        font-size: var(--boxel-font-size-md);
        font-weight: 700;
        letter-spacing: -0.015em;
      }
      .pitch-body {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
      }

      .agent-panel-row {
        display: grid;
        grid-template-columns: minmax(0, var(--_agents-panel-max-width));
      }
      .agent-panel {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        min-width: 0;
        padding: var(--boxel-sp-lg);
        border: 1px solid var(--boxel-light-10);
        border-radius: var(--boxel-border-radius-xl);
        background-color: var(--boxel-700);
        color: var(--foreground);
      }
      .panel-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .panel-title {
        margin: 0;
        font-size: var(--boxel-font-size);
        font-weight: 700;
      }
      .panel-note {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
      }

      .step-list {
        display: flex;
        flex-direction: column;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .step + .step {
        border-top: 1px solid var(--boxel-light-10);
      }
      .step-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding-block: var(--boxel-sp-xs);
      }
      .step-head {
        --pretui-button-h: 3.25rem;
        --pretui-button-px: var(--boxel-sp-4xs);
        justify-content: flex-start;
        gap: var(--boxel-sp-sm);
        width: 100%;
        text-align: start;
      }
      .step-number {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: var(--_agents-step-number-size);
        height: var(--_agents-step-number-size);
        border-radius: 50%;
        box-shadow: inset 0 0 0 1px var(--boxel-light-10);
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        color: var(--muted-foreground);
      }
      .step.is-next .step-number {
        background-color: var(--boxel-highlight);
        box-shadow: none;
        color: var(--boxel-highlight-foreground);
      }
      .step.is-done .step-number {
        box-shadow: inset 0 0 0 1px var(--boxel-highlight);
        color: var(--boxel-highlight);
      }
      .step-words {
        display: flex;
        white-space: normal;
        flex-direction: column;
        gap: var(--boxel-sp-6xs);
        min-width: 0;
      }
      .step-title {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .step.is-later .step-title {
        color: var(--muted-foreground);
      }
      .step-note {
        font-size: var(--boxel-font-size-xs);
        font-weight: 400;
        color: var(--muted-foreground);
      }
      .step-body {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--boxel-sp-xs);
        padding: 0 0 var(--boxel-sp-sm)
          calc(var(--_agents-step-number-size) + var(--boxel-sp-sm));
      }
      .workspace-pick {
        max-width: 100%;
      }
      .step-text {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        align-self: stretch;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-4xs) var(--boxel-sp-4xs)
          var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--boxel-800);
        box-shadow: inset 0 0 0 1px var(--boxel-light-10);
      }
      .step-code {
        flex: 1;
        min-width: 0;
        overflow-wrap: break-word;
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
      }
      .copy {
        flex: none;
      }
      .describe-it {
        align-self: flex-start;
      }
    </style>
  </template>
}

interface AgentStep {
  agent: DashboardAgent;
  index: number;
}
