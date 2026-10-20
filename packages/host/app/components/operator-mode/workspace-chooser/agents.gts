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
import SquareTerminal from '@cardstack/boxel-icons/square-terminal';
import { restartableTask, timeout } from 'ember-concurrency';

import { Button, RealmIcon } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import { formatRelativeTime } from './nav-rail';

const RECENT_SESSION_COUNT = 3;
const PULLABLE_WORKSPACE_COUNT = 4;
const COPIED_FEEDBACK_MS = 2000;

const INSTALL_CLI = 'npm install -g @cardstack/boxel-cli';
const SIGN_IN = 'boxel profile add';

// A line of a setup recipe: typed into the shell, or into the agent itself.
interface SetupLine {
  text: string;
  where: 'shell' | 'agent';
}

interface Harness {
  id: 'claude-code' | 'codex';
  name: string;
  lede: string;
  lines: SetupLine[];
}

// The commands come from the boxel-cli plugin README, which owns them.
const HARNESSES: Harness[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    lede: 'Install the CLI, sign in, then add the Boxel plugin.',
    lines: [
      { text: INSTALL_CLI, where: 'shell' },
      { text: SIGN_IN, where: 'shell' },
      { text: '/plugin marketplace add cardstack/boxel', where: 'agent' },
      { text: '/plugin install boxel-cli', where: 'agent' },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    lede: 'Codex has no plugin dependencies, so install both plugins.',
    lines: [
      { text: INSTALL_CLI, where: 'shell' },
      { text: SIGN_IN, where: 'shell' },
      { text: '/plugin marketplace add cardstack/boxel', where: 'agent' },
      { text: '/plugin install boxel-cli@cardstack-boxel', where: 'agent' },
      { text: '/plugin install boxel-skills@cardstack-boxel', where: 'agent' },
    ],
  },
];

interface PullableWorkspace {
  url: string;
  name: string;
  info: ReturnType<RealmService['info']>;
  command: string;
}

// The dashboard's Agents section: Boxel AI, which works inside Boxel, and
// the agents a user runs on their own machine through the Boxel CLI. Nothing
// here reports what an agent is doing; it gets one connected and hands it a
// workspace.
export default class Agents extends Component {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private matrixService: MatrixService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @tracked private copiedId: string | null = null;

  private harnesses = HARNESSES;

  private get recentSessions() {
    return this.aiAssistantPanelService.aiSessionRooms.slice(
      0,
      RECENT_SESSION_COUNT,
    );
  }

  // Favorites first, since they're what the user works on, then the rest of
  // their own workspaces. Catalogs are left out: they're read-only to most.
  private get pullableWorkspaces(): PullableWorkspace[] {
    let own = this.realmServer.userRealmIdentifiers as string[];
    let ownSet = new Set(own);
    let favorites = this.matrixService.workspaceFavorites.filter((url) =>
      ownSet.has(url),
    );
    let ordered = [...new Set([...favorites, ...own])];
    return ordered.slice(0, PULLABLE_WORKSPACE_COUNT).map((url) => {
      let info = this.realm.info(url);
      return {
        url,
        name: info.name,
        info,
        command: `boxel realm pull ${url} ./${localDirFor(url)}`,
      };
    });
  }

  private copyTask = restartableTask(async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    this.copiedId = id;
    if (!this.matrixService.dashboardState.agentCommandCopied) {
      await this.matrixService.updateDashboardState({
        agentCommandCopied: true,
      });
    }
    await timeout(COPIED_FEEDBACK_MS);
    this.copiedId = null;
  });

  @action private copySetup(harness: Harness) {
    let text = harness.lines.map((line) => line.text).join('\n');
    this.copyTask.perform(harness.id, text);
  }

  @action private copyPull(workspace: PullableWorkspace) {
    this.copyTask.perform(workspace.url, workspace.command);
  }

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
    <div class='agent-list' data-theme='dark' data-test-agents-list>
      <article class='agent-tile is-boxel-ai' data-test-agent-tile='boxel-ai'>
        <div class='agent-head'>
          <span class='agent-mark'>
            <Sparkles width='16' height='16' />
          </span>
          <span class='agent-name'>Boxel AI</span>
          <span class='agent-where'>in Boxel</span>
        </div>
        <p class='agent-lede'>
          Builds and changes cards in whichever workspace you have open.
        </p>
        {{#if this.recentSessions.length}}
          <ul class='session-list'>
            {{#each this.recentSessions as |session|}}
              <li>
                <button
                  type='button'
                  class='session-row'
                  {{on 'click' (fn this.openSession session.roomId)}}
                  data-test-agent-session={{session.roomId}}
                >
                  <MessageCircle class='session-icon' width='14' height='14' />
                  <span class='session-name'>{{session.name}}</span>
                  <span class='session-when'>{{this.formatWhen
                      session.lastActiveTimestamp
                    }}</span>
                </button>
              </li>
            {{/each}}
          </ul>
        {{/if}}
        <div class='agent-actions'>
          <Button
            @kind='primary'
            @size='small'
            {{on 'click' this.startSession}}
            data-test-agent-new-session
          >New session</Button>
        </div>
      </article>

      {{#each this.harnesses as |harness|}}
        <article class='agent-tile' data-test-agent-tile={{harness.id}}>
          <div class='agent-head'>
            <span class='agent-mark'>
              <SquareTerminal width='16' height='16' />
            </span>
            <span class='agent-name'>{{harness.name}}</span>
            <span class='agent-where'>on your machine</span>
          </div>
          <p class='agent-lede'>{{harness.lede}}</p>
          <ol class='setup-lines' aria-label='{{harness.name}} setup'>
            {{#each harness.lines as |line|}}
              <li class={{cn 'setup-line' (whereClass line.where)}}>
                <code>{{#each (words line.text) as |word|}}<span
                      class='word'
                    >{{word}}</span>
                  {{/each}}</code>
              </li>
            {{/each}}
          </ol>
          <div class='agent-actions'>
            <Button
              @size='small'
              @kind='secondary'
              {{on 'click' (fn this.copySetup harness)}}
              data-test-agent-copy-setup={{harness.id}}
            >
              {{#if (eq this.copiedId harness.id)}}
                <Check width='14' height='14' />
                Copied
              {{else}}
                <Copy width='14' height='14' />
                Copy setup
              {{/if}}
            </Button>
          </div>
        </article>
      {{/each}}

      {{#if this.pullableWorkspaces.length}}
        <article class='agent-tile is-handoff' data-test-agent-tile='pull'>
          <div class='agent-head'>
            <span class='agent-name'>Hand a workspace over</span>
          </div>
          <p class='agent-lede'>
            Pull a workspace into a folder, point your agent at it, and its
            edits sync back as cards.
          </p>
          <ul class='pull-list'>
            {{#each this.pullableWorkspaces key='url' as |workspace|}}
              <li class='pull-row'>
                <RealmIcon class='pull-icon' @realmInfo={{workspace.info}} />
                <span class='pull-name'>{{workspace.name}}</span>
                <button
                  type='button'
                  class={{cn
                    'pull-copy'
                    is-copied=(eq this.copiedId workspace.url)
                  }}
                  aria-label='Copy pull command for {{workspace.name}}'
                  title={{workspace.command}}
                  {{on 'click' (fn this.copyPull workspace)}}
                  data-test-agent-copy-pull={{workspace.url}}
                >
                  {{#if (eq this.copiedId workspace.url)}}
                    <Check width='14' height='14' />
                    Copied
                  {{else}}
                    <Copy width='14' height='14' />
                    Pull
                  {{/if}}
                </button>
              </li>
            {{/each}}
          </ul>
        </article>
      {{/if}}
    </div>

    <style scoped>
      .agent-list {
        --agent-tile-width: 19rem;
        --agent-line: color-mix(in oklch, var(--boxel-light) 10%, transparent);
        --agent-muted: color-mix(in oklch, var(--boxel-light) 58%, transparent);
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        gap: var(--boxel-sp-lg);
      }
      .agent-tile {
        width: var(--agent-tile-width);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-lg);
        border: 1px solid var(--agent-line);
        border-radius: 1.5rem;
        background-color: var(--boxel-700);
        box-shadow:
          0 0.75rem 1.75rem
            color-mix(in oklch, var(--boxel-dark) 35%, transparent),
          inset 0 1px 0 color-mix(in oklch, var(--boxel-light) 6%, transparent);
        color: var(--boxel-light);
      }
      /* Boxel AI is the agent already here, so its tile carries the glow. */
      .agent-tile.is-boxel-ai {
        background-image: radial-gradient(
          120% 80% at 0% 0%,
          color-mix(in oklch, var(--boxel-highlight) 18%, transparent),
          transparent 60%
        );
      }
      .agent-tile.is-handoff {
        background-color: transparent;
        border-style: dashed;
        box-shadow: none;
      }
      .agent-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .agent-mark {
        flex: none;
        width: 2rem;
        height: 2rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 0.625rem;
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 10%,
          transparent
        );
      }
      .is-boxel-ai .agent-mark {
        background-color: var(--boxel-highlight);
        color: var(--boxel-highlight-foreground);
      }
      .agent-name {
        font-size: var(--boxel-font-size);
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .agent-where {
        margin-left: auto;
        font-size: var(--boxel-font-size-xs);
        color: var(--agent-muted);
      }
      .agent-lede {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.45;
        color: var(--agent-muted);
      }
      .agent-actions {
        margin-top: auto;
        display: flex;
        gap: var(--boxel-sp-xs);
        padding-top: var(--boxel-sp-4xs);
      }
      .agent-actions :deep(button) {
        gap: var(--boxel-sp-4xs);
      }
      .agent-actions :deep(svg) {
        flex: none;
      }

      .session-list,
      .pull-list,
      .setup-lines {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .session-list,
      .pull-list {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-6xs);
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
        color: var(--agent-muted);
      }
      .session-name,
      .pull-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .session-when {
        flex: none;
        font-size: var(--boxel-font-size-xs);
        color: var(--agent-muted);
      }

      /* The recipe reads like a terminal: a prompt for the shell, a chevron
         for what is typed into the agent. */
      .setup-lines {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-sm);
        border-radius: 0.875rem;
        background-color: var(--boxel-800);
        box-shadow: inset 0 0 0 1px var(--agent-line);
      }
      .setup-line {
        display: flex;
        gap: var(--boxel-sp-xs);
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
        line-height: 1.5;
      }
      .setup-line::before {
        flex: none;
        width: 0.75rem;
        color: var(--boxel-highlight);
      }
      .setup-line.where-shell::before {
        content: '$';
      }
      .setup-line.where-agent::before {
        content: '›';
        color: var(--boxel-lime);
      }
      .setup-line code {
        min-width: 0;
        font: inherit;
        color: color-mix(in oklch, var(--boxel-light) 86%, transparent);
      }

      /* Commands wrap between words only, never inside a package name. */
      .setup-line .word {
        white-space: nowrap;
      }
      .pull-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-height: 2.5rem;
      }
      .pull-icon {
        --boxel-realm-icon-size: 1.5rem;
        --boxel-realm-icon-border-radius: 0.4375rem;
        --boxel-realm-icon-background-color: var(--boxel-light);
        flex: none;
      }
      .pull-copy {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        height: 1.75rem;
        padding: 0 var(--boxel-sp-xs);
        border: 1px solid var(--agent-line);
        border-radius: 0.875rem;
        background: none;
        color: var(--boxel-light);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        cursor: pointer;
        transition:
          background-color var(--boxel-transition),
          border-color var(--boxel-transition);
      }
      .pull-copy:hover {
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 8%,
          transparent
        );
      }
      .pull-copy:focus-visible {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: 2px;
      }
      .pull-copy.is-copied {
        border-color: var(--boxel-highlight);
        color: var(--boxel-highlight);
      }
      @media (max-width: 30rem) {
        .agent-list {
          --agent-tile-width: 100%;
        }
      }
    </style>
  </template>
}

const words = (text: string) => text.split(' ');
const whereClass = (where: SetupLine['where']) => `where-${where}`;

// "…/ctse/studio/" → "studio": the folder the pull lands in.
function localDirFor(url: string) {
  let segments = new URL(url).pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? 'workspace';
}
