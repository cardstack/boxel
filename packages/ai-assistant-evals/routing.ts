// Skill routing: for each prompt of an evaluation, whether the assistant
// opened a skill file that covers it. The card names the acceptable files per
// prompt (`expectedReads`); the room says which files were read after each
// prompt (`RoomAnalysis.readsByPrompt`). Pure: the spec calls it, and
// routing.test.ts covers it.

import { RealmPaths } from '@cardstack/runtime-common/paths';
import { SKILLS_REALM_PREFIX } from '@cardstack/runtime-common/realm-prefixes';
import { ri, rri } from '@cardstack/runtime-common/realm-identifiers';

// One prompt's expectation: skills-realm paths, any one of which covers the
// question. A path ending in `/` stands for every file under it. An empty list
// means the answer needs no read: it is in the room's context or the
// always-loaded index.
export type ExpectedReads = string[];

export type RoutingOutcome =
  // Read after this prompt.
  | 'opened'
  // Read after an earlier prompt, so already in context.
  | 'already-read'
  // Expected, and never read.
  | 'missed'
  // No read needed, and none made.
  | 'not-needed'
  // No read needed, but the model read anyway.
  | 'read-anyway'
  // None of the expected paths is in the skills the stack serves, so the
  // expectation can't be checked.
  | 'unchecked';

export interface PromptRouting {
  prompt: string;
  expected: string[];
  // Every file read after this prompt, as skills-realm paths where possible.
  opened: string[];
  // Expected paths the skills don't have.
  notFound: string[];
  outcome: RoutingOutcome;
}

export interface RoutingResult {
  // Prompts whose expectation holds, out of the prompts that could be
  // checked.
  met: number;
  checked: number;
  prompts: PromptRouting[];
  // Set when the room's prompts don't line up with the evaluation's, so the
  // reads may be credited to the wrong question.
  mismatch?: string;
}

// A read's path inside the skills realm. A model names a skill file by the
// realm's prefix (`@cardstack/skills/api-keys/SKILL.md`) or by the URL
// the stack serves it at (`skillsRealmURL`); either way the path is
// `api-keys/SKILL.md`. A read in neither form is returned as given.
export function skillsPath(read: string, skillsRealmURL: string): string {
  let id = rri(read);
  for (let realm of [
    new RealmPaths(ri(SKILLS_REALM_PREFIX)),
    new RealmPaths(new URL(skillsRealmURL)),
  ]) {
    if (realm.inRealm(id)) {
      return realm.local(id);
    }
  }
  return read;
}

const INDEX_PATH = 'index.md';

function covers(expected: string, path: string): boolean {
  return expected.endsWith('/')
    ? path.startsWith(expected)
    : path === expected.replace(/^\/+/, '');
}

export function scoreRouting(
  prompts: string[],
  expectedReads: ExpectedReads[],
  readsByPrompt: string[][],
  skillsRealmURL: string,
  exists: (path: string) => boolean = () => true,
): RoutingResult {
  // The index is in every room's context from the start, so reading it
  // again is not a read.
  let reads = readsByPrompt.map((list) =>
    list
      .map((read) => skillsPath(read, skillsRealmURL))
      .filter((path) => path !== INDEX_PATH),
  );
  let rows = prompts.map((prompt, index): PromptRouting => {
    let expected = expectedReads[index] ?? [];
    let opened = reads[index] ?? [];
    let earlier = reads.slice(0, index).flat();
    let notFound = expected.filter((path) => !exists(path));
    let checkable = expected.filter((path) => exists(path));
    let outcome: RoutingOutcome;
    if (expected.length === 0) {
      outcome = opened.length ? 'read-anyway' : 'not-needed';
    } else if (checkable.length === 0) {
      outcome = 'unchecked';
    } else if (
      checkable.some((path) =>
        (reads[index] ?? []).some((read) => covers(path, read)),
      )
    ) {
      outcome = 'opened';
    } else if (
      checkable.some((path) => earlier.some((read) => covers(path, read)))
    ) {
      outcome = 'already-read';
    } else {
      outcome = 'missed';
    }
    return { prompt, expected, opened, notFound, outcome };
  });
  let checkedRows = rows.filter((row) => row.outcome !== 'unchecked');
  let result: RoutingResult = {
    met: checkedRows.filter((row) => row.outcome !== 'missed').length,
    checked: checkedRows.length,
    prompts: rows,
  };
  if (readsByPrompt.length !== prompts.length) {
    result.mismatch = `the room has ${readsByPrompt.length} prompt(s) from the user, the evaluation ${prompts.length}`;
  }
  return result;
}

const OUTCOME_TEXT: Record<RoutingOutcome, string> = {
  opened: 'opened an expected skill',
  'already-read': 'an expected skill was already read',
  missed: 'missed: opened no expected skill',
  'not-needed': 'no read needed, none made',
  'read-anyway': 'no read needed, but read anyway',
  unchecked: 'unchecked: no expected skill exists',
};

export function routingSummary(result: RoutingResult): string {
  return `routing: ${result.met} of ${result.checked} questions opened an expected skill or needed none`;
}

export function routingLines(result: RoutingResult): string[] {
  return result.prompts.map((row) => {
    let question =
      row.prompt.length > 60 ? `${row.prompt.slice(0, 57)}...` : row.prompt;
    let parts = [`"${question}": ${OUTCOME_TEXT[row.outcome]}`];
    if (row.opened.length) {
      parts.push(`read ${row.opened.join(', ')}`);
    }
    if (row.notFound.length) {
      parts.push(`not in the skills: ${row.notFound.join(', ')}`);
    }
    return parts.join('; ');
  });
}
