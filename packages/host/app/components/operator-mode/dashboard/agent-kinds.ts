import type { DashboardAgent } from '@cardstack/runtime-common/dashboard-state';

export type { DashboardAgent };

export interface AgentKind {
  id: DashboardAgent;
  label: string;
  // What using it takes, in a few words.
  hint: string;
  // A neutral placeholder for the agent's mark.
  monogram: string;
  // Installs the Boxel plugin from the agent's chat. Boxel's own assistant
  // needs nothing installed, so it has none.
  installCommand?: string;
}

// The agents the dashboard offers, in the order it lists them. This is the
// one list: dropping an entry drops the agent from the picker, the rail's
// flyout and its setup steps.
export const AGENT_KINDS: AgentKind[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    hint: 'Boxel plugin',
    monogram: 'C',
    installCommand: '/plugin install boxel-cli',
  },
  {
    id: 'codex',
    label: 'Codex',
    hint: 'Boxel plugin',
    monogram: 'Cx',
    installCommand: '/plugin install boxel-cli@cardstack-boxel',
  },
  {
    id: 'grok',
    label: 'Grok Bot',
    hint: 'Boxel plugin',
    monogram: 'G',
    installCommand: '/plugin install boxel-cli@cardstack-boxel',
  },
  {
    id: 'boxel',
    label: 'Boxel AI Assistant',
    hint: 'Built into Boxel',
    monogram: 'B',
  },
];

// The picked agent, or the first one listed when nothing is picked or the
// stored pick is no longer listed.
export function agentKindFor(agent: string | undefined): AgentKind {
  return AGENT_KINDS.find((kind) => kind.id === agent) ?? AGENT_KINDS[0]!;
}

export interface SetupStep {
  title: string;
  note: string;
  // What the user types into the agent's chat.
  text: string;
  isWorkspacePick?: boolean;
}

// Every step is typed into the agent's own chat, never a terminal: the
// plugin's skills sign in, sync the workspace and open Boxel from there.
export function setupStepsFor(
  kind: AgentKind,
  workspaceURL: string | undefined,
): SetupStep[] {
  if (!kind.installCommand) {
    return [];
  }
  return [
    {
      title: 'Add the Boxel marketplace',
      note: `Type it in ${kind.label}’s chat`,
      text: '/plugin marketplace add cardstack/boxel',
    },
    {
      title: 'Install the Boxel plugin',
      note: 'Its card-building skills come with it',
      text: kind.installCommand,
    },
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
