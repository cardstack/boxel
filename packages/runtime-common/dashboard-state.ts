// The content of the app.boxel.dashboard account-data key. Fields are only
// ever added: a field whose meaning changes gets a new name, so every version
// of the app can read and write what any other stored.

// Coding agents that build through the Boxel plugin, and Boxel's own
// assistant.
export const DASHBOARD_AGENTS = ['claude', 'codex', 'grok', 'boxel'] as const;
export type DashboardAgent = (typeof DASHBOARD_AGENTS)[number];

export interface AppBoxelDashboardContent {
  onboardingDismissed?: boolean;
  // The agent the Agents section shows setup for.
  agent?: DashboardAgent;
  // How many setup steps the user has copied, per agent. Nothing can see the
  // agent's chat, so copying a step is what counts as doing it.
  agentSetup?: Partial<Record<DashboardAgent, number>>;
}

// Account data is whatever was last written, by any version of the app, so
// fields that don't match the current shape are dropped rather than trusted.
export function parseDashboardContent(
  content: unknown,
): AppBoxelDashboardContent {
  if (!isPlainObject(content)) {
    return {};
  }
  let parsed: AppBoxelDashboardContent = {};
  if (typeof content.onboardingDismissed === 'boolean') {
    parsed.onboardingDismissed = content.onboardingDismissed;
  }
  if (isDashboardAgent(content.agent)) {
    parsed.agent = content.agent;
  }
  if (isPlainObject(content.agentSetup)) {
    let agentSetup: Partial<Record<DashboardAgent, number>> = {};
    for (let [agent, done] of Object.entries(content.agentSetup)) {
      if (
        isDashboardAgent(agent) &&
        typeof done === 'number' &&
        Number.isInteger(done) &&
        done >= 0
      ) {
        agentSetup[agent] = done;
      }
    }
    if (Object.keys(agentSetup).length > 0) {
      parsed.agentSetup = agentSetup;
    }
  }
  return parsed;
}

// The content to store after applying `changes` to `stored`. Fields this app
// doesn't know are kept, so an older tab doesn't erase what a newer one stored.
// agentSetup is merged per agent, so setting one agent's progress keeps the
// others'. A field or agent set to undefined is cleared, since JSON drops it.
export function mergeDashboardContent(
  stored: unknown,
  changes: Partial<AppBoxelDashboardContent>,
): Record<string, unknown> {
  let base = isPlainObject(stored) ? stored : {};
  let next: Record<string, unknown> = { ...base, ...changes };
  if (changes.agentSetup) {
    next.agentSetup = {
      ...(isPlainObject(base.agentSetup) ? base.agentSetup : {}),
      ...changes.agentSetup,
    };
  }
  return next;
}

// Identifies stored content regardless of key order, which a round trip
// through the homeserver doesn't preserve.
export function dashboardContentKey(content: unknown): string {
  return JSON.stringify(sortKeys(content));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

function isDashboardAgent(value: unknown): value is DashboardAgent {
  return (DASHBOARD_AGENTS as readonly unknown[]).includes(value);
}

// Kept here rather than imported, so this module stays dependency-free for
// every package that reads it.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
