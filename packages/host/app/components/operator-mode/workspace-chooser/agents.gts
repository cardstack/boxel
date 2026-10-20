import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Check from '@cardstack/boxel-icons/check';
import Copy from '@cardstack/boxel-icons/copy';
import MessageCircle from '@cardstack/boxel-icons/message-circle';
import Sparkles from '@cardstack/boxel-icons/sparkles';
import { restartableTask, timeout } from 'ember-concurrency';

import { Button, RealmIcon } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import { formatRelativeTime } from './nav-rail';

const RECENT_SESSION_COUNT = 3;
const PICKABLE_WORKSPACE_COUNT = 4;
const COPIED_FEEDBACK_MS = 2000;
const STEP_COUNT = 5;

type AgentId = 'claude' | 'codex';

const AGENTS: { id: AgentId; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
];

interface SetupStep {
  index: number;
  number: number;
  title: string;
  note: string;
  command: string;
  state: 'done' | 'now' | 'later';
  isPull: boolean;
}

interface PickableWorkspace {
  url: string;
  name: string;
  info: ReturnType<RealmService['info']>;
}

// The dashboard's Agents section: how to build in Boxel with the agent a
// user already has. Five steps take them from installing the Boxel CLI to
// pushing their agent's first change, for Claude Code or Codex; beside them,
// Boxel AI for anyone without an agent of their own.
export default class Agents extends Component {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private matrixService: MatrixService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @tracked private agent: AgentId = 'claude';
  @tracked private pickedWorkspaceURL: string | null = null;
  // A step the user opened by hand; otherwise the next one to do is open.
  @tracked private openedStep: number | null = null;
  @tracked private copiedStep: number | null = null;

  private agents = AGENTS;

  private get recentSessions() {
    return this.aiAssistantPanelService.aiSessionRooms.slice(
      0,
      RECENT_SESSION_COUNT,
    );
  }

  // Favorites first, since they're what the user works on, then the rest of
  // their own workspaces. Catalogs are left out: most users can't push there.
  private get workspaces(): PickableWorkspace[] {
    let own = this.realmServer.userRealmIdentifiers as string[];
    let ownSet = new Set(own);
    let favorites = this.matrixService.workspaceFavorites.filter((url) =>
      ownSet.has(url),
    );
    return [...new Set([...favorites, ...own])]
      .slice(0, PICKABLE_WORKSPACE_COUNT)
      .map((url) => {
        let info = this.realm.info(url);
        return { url, name: info.name, info };
      });
  }

  private get workspaceURL() {
    return this.pickedWorkspaceURL ?? this.workspaces[0]?.url;
  }

  private get doneCount() {
    let done = this.matrixService.dashboardState.agentSetupDone ?? 0;
    return Math.min(Math.max(done, 0), STEP_COUNT);
  }

  private get openIndex() {
    return this.openedStep ?? Math.min(this.doneCount, STEP_COUNT - 1);
  }

  private get steps(): SetupStep[] {
    let realmURL = this.workspaceURL ?? '<workspace URL>';
    let folder = localDirFor(realmURL);
    let agentName = this.agent === 'codex' ? 'Codex' : 'Claude Code';
    let steps: [string, string, string][] = [
      [
        'Install the Boxel CLI',
        'One command, once per computer',
        'npm install -g @cardstack/boxel-cli',
      ],
      [
        'Sign in from the terminal',
        'Opens a browser to confirm it’s you',
        'boxel profile add',
      ],
      [
        'Pull a workspace to work on',
        'Any workspace you can edit',
        `boxel realm pull ${realmURL} ./${folder}`,
      ],
      [
        `Open ${agentName} in that folder`,
        'The workspace’s skills come along as your agent’s',
        `cd ${folder} && ${this.agent}`,
      ],
      [
        'Make a change and push it',
        'Your agent’s edits land in Boxel as cards',
        `boxel realm push ./${folder} ${realmURL}`,
      ],
    ];
    return steps.map(([title, note, command], index) => ({
      index,
      number: index + 1,
      title,
      note,
      command,
      state:
        index < this.doneCount
          ? 'done'
          : index === this.doneCount
            ? 'now'
            : 'later',
      isPull: index === 2,
    }));
  }

  @action private pickAgent(agent: AgentId) {
    this.agent = agent;
  }

  @action private pickWorkspace(url: string) {
    this.pickedWorkspaceURL = url;
  }

  @action private openStep(index: number) {
    this.openedStep = index;
  }

  // The dashboard cannot see a terminal, so a copied command is all it can
  // count: it marks the step copied (never "done") and opens the next.
  private copyTask = restartableTask(async (step: SetupStep) => {
    await navigator.clipboard.writeText(step.command);
    this.copiedStep = step.index;
    let done = Math.max(this.doneCount, step.index + 1);
    if (
      done !== this.doneCount ||
      !this.matrixService.dashboardState.agentCommandCopied
    ) {
      await this.matrixService.updateDashboardState({
        agentSetupDone: done,
        agentCommandCopied: true,
      });
    }
    await timeout(COPIED_FEEDBACK_MS);
    this.copiedStep = null;
    if (this.openedStep === step.index) {
      this.openedStep = null;
    }
  });

  @action private async openSession(roomId: string) {
    // `openPanel` reselects the persisted room, so enter it first.
    this.aiAssistantPanelService.enterRoom(roomId);
    await this.aiAssistantPanelService.openPanel();
  }

  @action private async startSession() {
    await this.aiAssistantPanelService.openPanel();
    await this.aiAssistantPanelService.createNewSession();
  }

  private formatWhen = (timestamp: number) => formatRelativeTime(timestamp);

  <template>
    <div class='make' data-theme='dark' data-test-agents>
      <div class='pitch'>
        <span class='eyebrow'>Bring your own agent</span>
        <h3 class='pitch-title'>Build with the agent you already pay for</h3>
        <p class='pitch-body'>
          The Boxel CLI puts a workspace on your computer as files. Claude Code
          or Codex edits its cards like any other code, and a push puts them
          back in Boxel, live.
        </p>
      </div>

      <div class='bench'>
        <section class='steps' aria-label='Connect your agent'>
          <div class='steps-top'>
            <span class='steps-title'>
              <b>Connect your agent</b>
              <span
                class='muted'
                data-test-agent-setup-progress
              >{{this.doneCount}} of 5 copied</span>
            </span>
            <span class='agent-pick' role='group' aria-label='Your agent'>
              {{#each this.agents as |agent|}}
                <button
                  type='button'
                  class='agent-option'
                  aria-pressed={{if (eq this.agent agent.id) 'true' 'false'}}
                  {{on 'click' (fn this.pickAgent agent.id)}}
                  data-test-agent-pick={{agent.id}}
                >{{agent.label}}</button>
              {{/each}}
            </span>
          </div>
          <div class='progress' aria-hidden='true'>
            {{#each this.steps as |step|}}
              <i class='bar {{stateClass step.state}}'></i>
            {{/each}}
          </div>
          <ol class='step-list'>
            {{#each this.steps as |step|}}
              <li
                class={{cn
                  'step'
                  (stateClass step.state)
                  is-open=(eq this.openIndex step.index)
                }}
                data-test-agent-step={{step.number}}
              >
                <button
                  type='button'
                  class='step-head'
                  aria-expanded={{if
                    (eq this.openIndex step.index)
                    'true'
                    'false'
                  }}
                  {{on 'click' (fn this.openStep step.index)}}
                >
                  <span class='step-number'>
                    {{#if (eq step.state 'done')}}
                      <Check width='14' height='14' />
                    {{else}}
                      {{step.number}}
                    {{/if}}
                  </span>
                  <span class='step-words'>
                    <b>{{step.title}}</b>
                    <span class='muted'>{{step.note}}</span>
                  </span>
                  <span class='step-state'>{{stateLabel step.state}}</span>
                </button>
                {{#if (eq this.openIndex step.index)}}
                  <div class='step-body'>
                    {{#if step.isPull}}
                      <span
                        class='workspace-pick'
                        role='group'
                        aria-label='Workspace to pull'
                      >
                        {{#each this.workspaces key='url' as |workspace|}}
                          <button
                            type='button'
                            class='workspace-option'
                            aria-pressed={{if
                              (eq this.workspaceURL workspace.url)
                              'true'
                              'false'
                            }}
                            {{on 'click' (fn this.pickWorkspace workspace.url)}}
                            data-test-agent-workspace={{workspace.url}}
                          >
                            <RealmIcon
                              class='workspace-icon'
                              @realmInfo={{workspace.info}}
                            />
                            <span
                              class='workspace-name'
                            >{{workspace.name}}</span>
                          </button>
                        {{/each}}
                      </span>
                    {{/if}}
                    <span class='command'>
                      <code
                        class='command-text'
                        data-test-agent-command
                      >{{step.command}}</code>
                      <button
                        type='button'
                        class={{cn
                          'copy'
                          is-copied=(eq this.copiedStep step.index)
                        }}
                        aria-label='Copy: {{step.command}}'
                        {{on 'click' (fn this.copyTask.perform step)}}
                        data-test-agent-copy={{step.number}}
                      >
                        {{#if (eq this.copiedStep step.index)}}
                          <Check width='14' height='14' />
                          Copied
                        {{else}}
                          <Copy width='14' height='14' />
                          Copy
                        {{/if}}
                      </button>
                    </span>
                  </div>
                {{/if}}
              </li>
            {{/each}}
          </ol>
        </section>

        <section class='browser' aria-label='Boxel AI'>
          <span class='eyebrow'>No agent?</span>
          <b class='browser-title'>Build in the browser</b>
          <span class='muted'>Describe what you want and Boxel AI makes it in
            your workspace. Uses credits.</span>
          <Button
            class='browser-action'
            @kind='primary'
            @size='small'
            {{on 'click' this.startSession}}
            data-test-agent-new-session
          >
            <Sparkles width='14' height='14' />
            Describe it
          </Button>
          {{#if this.recentSessions.length}}
            <ul class='session-list' aria-label='Recent Boxel AI sessions'>
              {{#each this.recentSessions as |session|}}
                <li>
                  <button
                    type='button'
                    class='session-row'
                    {{on 'click' (fn this.openSession session.roomId)}}
                    data-test-agent-session={{session.roomId}}
                  >
                    <MessageCircle
                      class='session-icon'
                      width='14'
                      height='14'
                    />
                    <span class='session-name'>{{session.name}}</span>
                    <span class='muted'>{{this.formatWhen
                        session.lastActiveTimestamp
                      }}</span>
                  </button>
                </li>
              {{/each}}
            </ul>
          {{/if}}
        </section>
      </div>
    </div>

    <style scoped>
      .make {
        --make-line: color-mix(in oklch, var(--boxel-light) 10%, transparent);
        --make-muted: color-mix(in oklch, var(--boxel-light) 58%, transparent);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        color: var(--boxel-light);
      }
      .muted {
        color: var(--make-muted);
      }
      .eyebrow {
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-2xs);
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--boxel-highlight);
      }

      /* The pitch: why, before how. */
      .pitch {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        max-width: 38rem;
      }
      .pitch-title {
        margin: 0;
        font-size: 1.75rem;
        font-weight: 700;
        line-height: 1.1;
        letter-spacing: -0.02em;
      }
      .pitch-body {
        margin: 0;
        font-size: var(--boxel-font-size);
        line-height: 1.5;
        color: var(--make-muted);
      }

      .bench {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--boxel-sp-lg);
      }
      .steps,
      .browser {
        box-sizing: border-box;
        border: 1px solid var(--make-line);
        border-radius: 1.375rem;
      }
      .steps {
        flex: 1.6 1 30rem;
        max-width: 40rem;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-lg);
        background-color: var(--boxel-700);
        box-shadow:
          0 0.875rem 1.875rem
            color-mix(in oklch, var(--boxel-dark) 35%, transparent),
          inset 0 1px 0 color-mix(in oklch, var(--boxel-light) 6%, transparent);
      }
      .steps-top {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
      }
      .steps-title {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size);
      }
      .steps-title .muted {
        font-size: var(--boxel-font-size-sm);
      }
      .agent-pick {
        display: inline-flex;
        padding: 0.1875rem;
        border-radius: 1rem;
        background-color: var(--boxel-800);
        box-shadow: inset 0 0 0 1px var(--make-line);
      }
      .agent-option {
        height: 1.75rem;
        padding: 0 var(--boxel-sp-sm);
        border: 0;
        border-radius: 0.875rem;
        background: none;
        color: var(--make-muted);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        cursor: pointer;
      }
      .agent-option[aria-pressed='true'] {
        background-color: var(--boxel-highlight);
        color: var(--boxel-highlight-foreground);
      }
      .agent-option:focus-visible {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: 2px;
      }
      .progress {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: var(--boxel-sp-5xs);
      }
      .bar {
        height: 0.25rem;
        border-radius: 0.125rem;
        background-color: var(--make-line);
      }
      .bar.is-done {
        background-color: var(--boxel-highlight);
      }
      .bar.is-now {
        background-color: color-mix(
          in oklch,
          var(--boxel-highlight) 40%,
          transparent
        );
      }

      .step-list {
        display: flex;
        flex-direction: column;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .step + .step {
        border-top: 1px solid var(--make-line);
      }
      .step-head {
        width: 100%;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-xs) 0;
        border: 0;
        background: none;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .step-head:focus-visible {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: 2px;
        border-radius: 0.5rem;
      }
      .step-number {
        flex: none;
        width: 1.75rem;
        height: 1.75rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        box-shadow: inset 0 0 0 1px var(--make-line);
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        color: var(--make-muted);
      }
      .step.is-now .step-number {
        background-color: var(--boxel-highlight);
        box-shadow: none;
        color: var(--boxel-highlight-foreground);
      }
      .step.is-done .step-number {
        box-shadow: inset 0 0 0 1px var(--boxel-highlight);
        color: var(--boxel-highlight);
      }
      .step-words {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-6xs);
        font-size: var(--boxel-font-size-sm);
      }
      .step-words .muted {
        font-size: var(--boxel-font-size-xs);
      }
      .step.is-later .step-words b {
        color: var(--make-muted);
      }
      .step-state {
        flex: none;
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-2xs);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--make-muted);
      }
      .step.is-now .step-state {
        color: var(--boxel-highlight);
      }
      .step-body {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: 0 0 var(--boxel-sp-sm) calc(1.75rem + var(--boxel-sp-sm));
      }
      .workspace-pick {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-5xs);
      }
      .workspace-option {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        max-width: 12rem;
        height: 1.875rem;
        padding: 0 var(--boxel-sp-xs) 0 0.25rem;
        border: 1px solid var(--make-line);
        border-radius: 0.9375rem;
        background: none;
        color: var(--make-muted);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        cursor: pointer;
      }
      .workspace-option[aria-pressed='true'] {
        border-color: var(--boxel-highlight);
        color: var(--boxel-light);
      }
      .workspace-option:focus-visible {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: 2px;
      }
      .workspace-icon {
        --boxel-realm-icon-size: 1.375rem;
        --boxel-realm-icon-border-radius: 50%;
        --boxel-realm-icon-background-color: var(--boxel-light);
        flex: none;
      }
      .workspace-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .command {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-4xs) var(--boxel-sp-4xs) var(--boxel-sp-4xs)
          var(--boxel-sp-sm);
        border-radius: 0.75rem;
        background-color: var(--boxel-800);
        box-shadow: inset 0 0 0 1px var(--make-line);
      }
      .command-text {
        flex: 1;
        min-width: 0;
        overflow-x: auto;
        white-space: nowrap;
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
        color: color-mix(in oklch, var(--boxel-light) 88%, transparent);
        scrollbar-width: none;
      }
      .command-text::before {
        content: '$ ';
        color: var(--boxel-highlight);
      }
      .copy {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        height: 1.75rem;
        padding: 0 var(--boxel-sp-xs);
        border: 0;
        border-radius: 0.875rem;
        background-color: var(--boxel-highlight);
        color: var(--boxel-highlight-foreground);
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        cursor: pointer;
      }
      .copy:hover {
        background-color: var(--boxel-highlight-hover);
      }
      .copy:focus-visible {
        outline: 2px solid var(--boxel-light);
        outline-offset: 2px;
      }

      /* Boxel AI, for anyone without an agent: the dashed edge says it's
         the other way in, not a sixth step. */
      .browser {
        flex: 1 1 16rem;
        max-width: 22rem;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-lg);
        border-style: dashed;
        background-image: radial-gradient(
          120% 80% at 0% 0%,
          color-mix(in oklch, var(--boxel-highlight) 14%, transparent),
          transparent 60%
        );
        font-size: var(--boxel-font-size-sm);
        line-height: 1.45;
      }
      .browser-title {
        font-size: var(--boxel-font-size-lg);
      }
      .browser-action {
        align-self: flex-start;
        gap: var(--boxel-sp-4xs);
        margin-top: var(--boxel-sp-4xs);
      }
      .session-list {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-6xs);
        margin: var(--boxel-sp-xs) 0 0;
        padding: var(--boxel-sp-xs) 0 0;
        border-top: 1px solid var(--make-line);
        list-style: none;
      }
      .session-row {
        width: 100%;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        border: 0;
        border-radius: 0.625rem;
        background: none;
        color: inherit;
        text-align: left;
        font-size: var(--boxel-font-size-xs);
        cursor: pointer;
      }
      .session-row:hover,
      .session-row:focus-visible {
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 8%,
          transparent
        );
        outline: none;
      }
      .session-icon {
        flex: none;
        color: var(--make-muted);
      }
      .session-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
      }
      @media (max-width: 30rem) {
        .steps,
        .browser {
          flex-basis: 100%;
          max-width: none;
        }
        .pitch-title {
          font-size: 1.375rem;
        }
      }
    </style>
  </template>
}

const stateClass = (state: SetupStep['state']) => `is-${state}`;

const stateLabel = (state: SetupStep['state']) =>
  state === 'done' ? 'Copied' : state === 'now' ? 'Next' : '';

// "…/ctse/studio/" → "studio": the folder the pull lands in.
function localDirFor(url: string) {
  try {
    let segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? 'workspace';
  } catch {
    return 'workspace';
  }
}
