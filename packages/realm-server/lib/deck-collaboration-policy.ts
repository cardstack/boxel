import { realmRRI } from '@cardstack/deck';

export interface DeckCollaborationPolicy {
  enabled: boolean;
  realmRRIs: ReadonlySet<string>;
}

export function deckCollaborationPolicyFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): DeckCollaborationPolicy {
  return {
    enabled: environment.BOXEL_DECK_COLLABORATION_ENABLED === 'true',
    realmRRIs: new Set(
      (environment.BOXEL_DECK_COLLABORATION_REALM_RRIS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value !== '')
        .map((value) => realmRRI(value)),
    ),
  };
}

export function hasDeckCollaboration(
  policy: DeckCollaborationPolicy | undefined,
  identifier: string,
): boolean {
  let canonical = realmRRI(identifier);
  return policy?.enabled === true && policy.realmRRIs.has(canonical);
}
