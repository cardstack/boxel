import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// The user's first realm is always created at this endpoint (both the host's
// signup flow and boxel-cli's ensurePersonalRealm post `endpoint: 'personal'`),
// and the endpoint collides on a second attempt — so it uniquely identifies the
// user's personal, first-created realm.
const PERSONAL_REALM_ENDPOINT = 'personal';

// Filename of the seeded Home README, relative to the realm root. The Workspace
// card's `readme` field (linksTo MarkdownDef) links to this so it renders on Home.
export const REALM_README_FILENAME = 'README.md';

// Whether to seed a Home README into a newly created realm. Gated by
// SEED_REALM_README so the mechanism can ship ahead of the finalized copy, and
// scoped to the personal endpoint so only the user's first realm gets one.
export function shouldSeedRealmReadme(endpoint: string): boolean {
  return (
    process.env.SEED_REALM_README === 'true' &&
    endpoint === PERSONAL_REALM_ENDPOINT
  );
}

// Placeholder README content, kept as a sibling markdown file so the copy is
// easy to refine without touching code. Read lazily and cached — the template
// ships with the realm-server source.
let cached: string | undefined;
export function realmReadmeTemplate(): string {
  if (cached === undefined) {
    cached = readFileSync(
      fileURLToPath(new URL('./realm-readme-template.md', import.meta.url)),
      'utf8',
    );
  }
  return cached;
}
