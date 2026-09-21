// What the assistant actually left behind, read back from the test workspace
// once the run ends. The screenshot and the room say what the assistant showed
// and claimed; this says what is on disk and what the realm indexed, which is
// the only evidence that distinguishes a real computed field from a number
// typed into an instance, or one definition edited in place from a second one
// written beside it.
//
// Saved next to the result as <model>.workspace.json, so a run stays judgeable
// after its workspace is gone.

import type { CardDocument, RealmClient } from './realm-api.ts';

// Bytes worth reading. A card definition or an instance is small; a binary
// upload is not, and nothing in the criteria turns on one.
const TEXT_FILE = /\.(gts|ts|js|json|md|css|txt|hbs)$/i;
const MAX_FILE_BYTES = 200_000;

export interface WorkspaceSnapshot {
  realmUrl: string;
  // Every path in the realm, including ones too big or too binary to include
  // below, so a missing entry is never mistaken for a missing file.
  paths: string[];
  // path -> source, for the text files small enough to keep.
  files: Record<string, string>;
  // card URL -> the indexed document. Computed fields only exist here: the
  // instance on disk holds what was written, the indexed document holds what
  // the card actually evaluates to.
  cards: Record<string, CardDocument>;
  // Anything that could not be read, so a gap in the evidence is visible
  // rather than silent.
  errors: string[];
}

export async function captureWorkspace(
  client: RealmClient,
  realmUrl: string,
): Promise<WorkspaceSnapshot> {
  let snapshot: WorkspaceSnapshot = {
    realmUrl,
    paths: [],
    files: {},
    cards: {},
    errors: [],
  };

  try {
    snapshot.paths = await client.listFiles(realmUrl);
  } catch (error) {
    snapshot.errors.push(`listing the workspace failed: ${message(error)}`);
    return snapshot;
  }

  for (let path of snapshot.paths) {
    if (!TEXT_FILE.test(path)) {
      continue;
    }
    try {
      let { body } = await client.getSource(realmUrl, `${realmUrl}${path}`);
      if (body.byteLength > MAX_FILE_BYTES) {
        snapshot.errors.push(`${path} is ${body.byteLength} bytes, not read`);
        continue;
      }
      snapshot.files[path] = new TextDecoder().decode(body);
    } catch (error) {
      snapshot.errors.push(`reading ${path} failed: ${message(error)}`);
    }
  }

  for (let path of snapshot.paths.filter((p) => p.endsWith('.json'))) {
    let cardUrl = `${realmUrl}${path.replace(/\.json$/, '')}`;
    try {
      snapshot.cards[cardUrl] = await client.getCard(realmUrl, cardUrl);
    } catch (error) {
      // A .json file that is not a card is ordinary, not a gap in the
      // evidence: its bytes are already in `files`.
      snapshot.errors.push(
        `${path} is not readable as a card: ${message(error)}`,
      );
    }
  }

  return snapshot;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
