import { CATALOG_REALM_PREFIX } from '../realm-prefixes.ts';

export const DEBUG_COMMAND_PREFIX = 'boxel-debug';

// The skill features a room can enable, with what each one does. A feature
// is a section of a skill file between `<!-- feature:<name> -->` and
// `<!-- /feature:<name> -->`, left out of the prompt unless the room enabled
// it. A name added to a skill file must be added here too, or no room can
// enable it.
export const SKILL_FEATURES = {
  'catalog-reuse':
    'Makes the assistant search the catalog for a listing to install or remix, and for specs to reuse, before it writes any .gts file.',
} as const satisfies Record<string, string>;

// The realms a feature's skill sections send the assistant to search, by
// realm prefix. In a room that has not enabled the feature, the host leaves
// them out of every search a run-realm-code script makes, so turning a
// feature off removes its realms along with its skill text. Keyed by
// SKILL_FEATURES names, so a misspelled key is a type error rather than a
// realm no room can ever enable.
export const SKILL_FEATURE_REALMS: {
  [feature in keyof typeof SKILL_FEATURES]?: string[];
} = {
  'catalog-reuse': [CATALOG_REALM_PREFIX],
};

// The realms gated behind a feature that `enabledFeatures` does not include.
export function realmsOfDisabledFeatures(enabledFeatures: string[]): string[] {
  return Object.entries(SKILL_FEATURE_REALMS).flatMap(([feature, realms]) =>
    enabledFeatures.includes(feature) ? [] : (realms ?? []),
  );
}

// The command names the bot used before they moved under `boxel-debug:`.
const LEGACY_DEBUG_COMMAND_RE =
  /^debug(:(help|prompt|eventlist|title|boom|patch|feature)\b[\s\S]*)?$/;

// A message that looks like one of the old `debug:` commands. The bot answers
// it with a pointer to `boxel-debug` rather than sending it to the model.
export function isLegacyDebugCommand(eventBody: string) {
  return LEGACY_DEBUG_COMMAND_RE.test(eventBody.trim());
}

// A message is a debug command when it is `boxel-debug` on its own or starts
// with `boxel-debug:`, or looks like one of the old `debug:` commands. The bot
// answers it itself and never sends it to the model; an unknown command gets
// the list of commands.
export function isRecognisedDebugCommand(eventBody: string) {
  let body = eventBody.trim();
  return (
    body === DEBUG_COMMAND_PREFIX ||
    body.startsWith(`${DEBUG_COMMAND_PREFIX}:`) ||
    isLegacyDebugCommand(body)
  );
}

const FEATURE_COMMAND_RE = /^boxel-debug:feature:(enable|disable):([\w-]+)\s*$/;

export function parseFeatureCommand(
  eventBody: string,
): { enable: boolean; feature: string } | undefined {
  let match = FEATURE_COMMAND_RE.exec(eventBody.trim());
  return match
    ? { enable: match[1] === 'enable', feature: match[2] }
    : undefined;
}

// The skill features a room has enabled with `boxel-debug:feature:enable:<name>`,
// less those it disabled again with `boxel-debug:feature:disable:<name>`. They are
// read back from the room's own messages, so they last as long as the room
// does and need no storage of their own.
export function sessionSkillFeatures(
  eventList: { type: string; sender: string; content: unknown }[],
  aiBotUserId: string,
): string[] {
  let features = new Set<string>();
  for (let event of eventList) {
    if (event.type !== 'm.room.message' || event.sender === aiBotUserId) {
      continue;
    }
    let body = (event.content as { body?: unknown })?.body;
    let command =
      typeof body === 'string' ? parseFeatureCommand(body) : undefined;
    if (!command || !(command.feature in SKILL_FEATURES)) {
      continue;
    }
    if (command.enable) {
      features.add(command.feature);
    } else {
      features.delete(command.feature);
    }
  }
  return [...features];
}
