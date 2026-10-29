import type { DashboardAgent } from '@cardstack/runtime-common/dashboard-state';

export type { DashboardAgent };

export interface SetupStep {
  title: string;
  note: string;
  // What the user types or runs.
  text: string;
  isWorkspacePick?: boolean;
}

export interface AgentKind {
  id: DashboardAgent;
  label: string;
  // What using it takes, in a few words.
  hint: string;
  // Puts Boxel in the agent, before the workspace steps every agent shares.
  // Boxel's own assistant needs nothing installed, so it has none.
  setup?: SetupStep[];
}

// The plugin's skills shell out to the Boxel CLI, so its manifest requires it
// on PATH, installed the same way whichever agent runs it.
const CLI_STEP: SetupStep = {
  title: 'Install the Boxel CLI',
  note: 'In a terminal, or ask your agent to run it',
  text: 'npm install -g @cardstack/boxel-cli',
};

// The agents the dashboard offers, in the order it lists them. This is the
// one list: dropping an entry drops the agent from the picker, the rail's
// flyout and its setup steps. A stored pick that isn't listed falls back to
// the first agent.
export const AGENT_KINDS: AgentKind[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    hint: 'Boxel plugin',
    // Installing boxel-cli brings boxel-skills with it, as a dependency.
    setup: [
      CLI_STEP,
      {
        title: 'Add the Boxel marketplace',
        note: 'Type it in Claude Code’s chat',
        text: '/plugin marketplace add cardstack/boxel',
      },
      {
        title: 'Install the Boxel plugin',
        note: 'Its card-building skills come with it',
        text: '/plugin install boxel-cli@cardstack-boxel',
      },
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    hint: 'Boxel plugin',
    // Codex doesn't install a plugin's dependencies, so both plugins are
    // added by hand.
    setup: [
      CLI_STEP,
      {
        title: 'Add the Boxel marketplace',
        note: 'In a terminal, or ask Codex to run it',
        text: 'codex plugin marketplace add cardstack/boxel',
      },
      {
        title: 'Install both Boxel plugins',
        note: 'Open Plugins, add boxel-cli and boxel-skills, then start a new chat',
        text: '/plugins',
      },
    ],
  },
  {
    id: 'boxel',
    label: 'Boxel AI Assistant',
    hint: 'Built into Boxel',
  },
];

// The picked agent, or the first one listed when nothing is picked or the
// stored pick is no longer listed.
export function agentKindFor(agent: string | undefined): AgentKind {
  return AGENT_KINDS.find((kind) => kind.id === agent) ?? AGENT_KINDS[0]!;
}

// The agent's own setup, then the steps typed into its chat: the plugin's
// skills sign in, sync the workspace and open Boxel from there.
export function setupStepsFor(
  kind: AgentKind,
  workspaceURL: string | undefined,
): SetupStep[] {
  if (!kind.setup) {
    return [];
  }
  return [
    ...kind.setup,
    {
      title: 'Open a workspace',
      note: 'Your agent signs you in and syncs it',
      text: `Work on my Boxel workspace ${workspaceURL ?? '<workspace URL>'}`,
      isWorkspacePick: true,
    },
    {
      title: 'Ask for a change',
      note: 'In your own words, like any request',
      text: 'Make me a card for tracking tasks in this workspace',
    },
    {
      title: 'See it in Boxel',
      note: 'Boxel opens with the change live',
      text: 'Show it to me in Boxel',
    },
  ];
}
