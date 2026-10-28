// Reads an EvaluationCard (eval-realm/evaluation.gts) into a self-contained
// bundle, and copies a bundle's initial cards and files into a fresh test
// workspace. The bundle carries the file bytes, so the browser workers, which
// run as the eval users, never need access to the workspace the evaluation
// lives in: only the writer that made the bundle does.

import { RealmPaths } from '@cardstack/runtime-common/paths';

import {
  ensureTrailingSlash,
  waitForCard,
  type CardDocument,
  type RealmClient,
} from './realm-api.ts';

export interface Evaluation {
  url: string;
  realmUrl: string;
  name: string;
  prompts: string[];
  successCriteria: string;
  // Absolute URLs, as the realm serializes them.
  initialCards: string[];
  initialFiles: string[];
  // Seeded cards the prompt asks the assistant to change, each one in
  // `initialCards` or a card `.json` in `initialFiles`. When set, every one of
  // these must differ from its seed, and only one of them, shown on screen,
  // counts as a rendered card.
  expectedChangedCards: string[];
  // The card each prompt is about, by position, each one in `initialCards`.
  // The runner brings it to the top of the stack before that prompt.
  promptCards: string[];
  // Skill features to enable in the room before the first prompt.
  skillFeatures: string[];
  // Overrides the GOOD grade's default time budget per prompt.
  secondsPerPrompt?: number;
  adoptsFrom: { module: string; name: string };
}

export interface BundledFile {
  // Relative to the realm root, in both the source and the test workspace.
  path: string;
  // Base64 of the bytes.
  content: string;
  // One of the evaluation's `initialCards`, which the runner opens.
  isCard: boolean;
}

export interface EvaluationBundle extends Evaluation {
  files: BundledFile[];
}

const TEXT_EXTENSIONS = /\.(gts|gjs|ts|js|json|md|txt|css|html|csv|svg)$/i;

function linkedIds(
  doc: CardDocument,
  field: string,
  relativeTo: string,
): string[] {
  let relationships = doc.data.relationships ?? {};
  let ids: string[] = [];
  for (let [key, value] of Object.entries(relationships)) {
    if (key !== field && !key.startsWith(`${field}.`)) {
      continue;
    }
    let self = value?.links?.self;
    if (typeof self === 'string' && self) {
      ids.push(new URL(self, relativeTo).href);
    }
  }
  return ids;
}

export async function loadEvaluation(
  client: RealmClient,
  cardUrl: string,
): Promise<Evaluation> {
  let realmUrl = await client.realmOf(cardUrl);
  let doc = await client.getCard(realmUrl, cardUrl);
  let attributes = doc.data.attributes ?? {};
  let prompt: string | undefined = attributes.assistantPrompt;
  if (!prompt?.trim()) {
    throw new Error(`${cardUrl} has no assistantPrompt`);
  }
  let followUps: string[] = Array.isArray(attributes.followUpPrompts)
    ? attributes.followUpPrompts.filter(
        (p: unknown): p is string => typeof p === 'string' && p.trim() !== '',
      )
    : [];
  let id = doc.data.id ?? cardUrl;
  let initialCards = linkedIds(doc, 'initialCards', id);
  let initialFiles = linkedIds(doc, 'initialFiles', id);
  // A card link may be spelled with its `.json` suffix, as `initialCards`
  // tolerates; the id without it is what the runner compares.
  let expectedChangedCards = linkedIds(doc, 'expectedChangedCards', id).map(
    cardIdOf,
  );
  for (let card of expectedChangedCards) {
    if (
      !initialCards.some((seed) => cardIdOf(seed) === card) &&
      !initialFiles.includes(`${card}.json`)
    ) {
      throw new Error(
        `${cardUrl} expects ${card} to change, but does not seed it in initialCards or initialFiles`,
      );
    }
  }
  let promptCards = linkedIds(doc, 'promptCards', id).map(cardIdOf);
  for (let card of promptCards) {
    if (!initialCards.some((seed) => cardIdOf(seed) === card)) {
      throw new Error(
        `${cardUrl} names ${card} as a prompt card, but does not open it in initialCards`,
      );
    }
  }
  return {
    url: id,
    realmUrl: ensureTrailingSlash(doc.data.meta.realmURL ?? realmUrl),
    name:
      attributes.cardInfo?.name ??
      attributes.cardTitle ??
      attributes.title ??
      id.split('/').pop() ??
      'evaluation',
    prompts: [prompt, ...followUps],
    successCriteria: attributes.successCriteria ?? '',
    initialCards,
    initialFiles,
    expectedChangedCards,
    promptCards,
    skillFeatures: Array.isArray(attributes.skillFeatures)
      ? attributes.skillFeatures.filter(
          (f: unknown): f is string => typeof f === 'string' && f.trim() !== '',
        )
      : [],
    secondsPerPrompt:
      typeof attributes.secondsPerPrompt === 'number' &&
      attributes.secondsPerPrompt > 0
        ? attributes.secondsPerPrompt
        : undefined,
    adoptsFrom: doc.data.meta.adoptsFrom,
  };
}

// A card's id: its instance URL without the `.json` suffix.
function cardIdOf(url: string): string {
  return url.replace(/\.json$/, '');
}

// `url`'s path inside the evaluation's realm. Paths are decoded, so a URL is
// rebuilt from one with `RealmPaths.fileURL`, which encodes it again the way
// the realm and the rendered `data-test-card` ids spell it.
function localPath(url: string, realmUrl: string): string {
  let paths = new RealmPaths(new URL(realmUrl));
  if (!paths.inRealm(new URL(url))) {
    throw new Error(
      `${url} is outside the evaluation's realm ${realmUrl}; initial cards and files must live in the same workspace as the evaluation`,
    );
  }
  return paths.local(new URL(url));
}

// Fetches every initial file and card. A card's own module is bundled too
// when it is a relative reference the evaluation did not list, since a card
// without its definition is an error card.
export async function loadEvaluationBundle(
  client: RealmClient,
  cardUrl: string,
): Promise<EvaluationBundle> {
  let evaluation = await loadEvaluation(client, cardUrl);
  let files = new Map<string, BundledFile>();

  let addFile = async (sourceUrl: string, isCard: boolean) => {
    let { url, body } = await client.getSource(evaluation.realmUrl, sourceUrl);
    let path = localPath(url, evaluation.realmUrl);
    if (!files.has(path)) {
      files.set(path, {
        path,
        content: Buffer.from(body).toString('base64'),
        isCard,
      });
    }
    return { path, body };
  };

  for (let fileUrl of evaluation.initialFiles) {
    await addFile(fileUrl, false);
  }
  for (let id of evaluation.initialCards) {
    let jsonUrl = id.endsWith('.json') ? id : `${id}.json`;
    let { body } = await addFile(jsonUrl, true);
    let parsed: CardDocument | undefined;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body)) as CardDocument;
    } catch {
      // copied verbatim; the realm reports the problem at index time
    }
    let module = parsed?.data?.meta?.adoptsFrom?.module;
    if (module && (module.startsWith('.') || module.startsWith('/'))) {
      let moduleUrl = new URL(module, jsonUrl).href;
      if (moduleUrl.startsWith(evaluation.realmUrl)) {
        await addFile(moduleUrl, false);
      }
    }
  }
  return { ...evaluation, files: [...files.values()] };
}

export interface Prepopulated {
  // Ids of the evaluation's `initialCards` in the test workspace, in the order
  // the evaluation listed them: the cards the runner opens.
  cards: string[];
  files: string[];
  // Every card instance copied in, `initialCards` and card `.json` files from
  // `initialFiles` alike.
  seededCards: string[];
}

// Writes the bundle's files into the test workspace at the same path they
// had in the source, so relative references between them keep working, then
// waits for every card instance among them to be indexed, so the prompt goes
// out to a workspace that already serves them.
export async function prepopulate(
  client: RealmClient,
  bundle: EvaluationBundle,
  testRealmUrl: string,
  log: (line: string) => void = () => {},
): Promise<Prepopulated> {
  testRealmUrl = ensureTrailingSlash(testRealmUrl);
  let testRealm = new RealmPaths(new URL(testRealmUrl));
  let cards: string[] = [];
  let files: string[] = [];
  let seededCards: string[] = [];
  for (let file of bundle.files) {
    let url = testRealm.fileURL(file.path).href;
    let bytes = Buffer.from(file.content, 'base64');
    if (TEXT_EXTENSIONS.test(file.path)) {
      await client.putSource(testRealmUrl, url, bytes.toString('utf8'));
    } else {
      await client.putBinary(testRealmUrl, url, new Uint8Array(bytes));
    }
    log(`copied ${file.path}`);
    if (file.isCard) {
      cards.push(cardIdOf(url));
    } else {
      files.push(url);
    }
    if (file.isCard || isCardInstance(file.path, bytes)) {
      seededCards.push(cardIdOf(url));
    }
  }
  // Keep the evaluation's own order for the cards, since the first ones are
  // what the runner opens in the stack.
  let order = bundle.initialCards.map((id) =>
    cardIdOf(localPath(id, bundle.realmUrl)),
  );
  let position = (id: string) => order.indexOf(localPath(id, testRealmUrl));
  cards.sort((a, b) => position(a) - position(b));
  for (let cardId of seededCards) {
    await waitForCard(client, testRealmUrl, cardId);
    log(`indexed ${cardId}`);
  }
  return { cards, files, seededCards };
}

// A `.json` file whose document adopts from a card definition.
function isCardInstance(path: string, bytes: Buffer): boolean {
  if (!path.endsWith('.json')) {
    return false;
  }
  try {
    let doc = JSON.parse(bytes.toString('utf8')) as Partial<CardDocument>;
    return Boolean(doc.data?.meta?.adoptsFrom);
  } catch {
    return false;
  }
}

// The id in the test workspace of each card the evaluation brings to the top
// before a prompt, by prompt position.
export function promptCardIds(
  bundle: EvaluationBundle,
  testRealmUrl: string,
): string[] {
  let testRealm = new RealmPaths(new URL(testRealmUrl));
  return (bundle.promptCards ?? []).map(
    (id) => testRealm.fileURL(localPath(id, bundle.realmUrl)).href,
  );
}

// The seed of each card the evaluation expects the assistant to change: its
// card id in the test workspace and the bytes it started with.
export function expectedChangedSeeds(
  bundle: EvaluationBundle,
  testRealmUrl: string,
): { cardId: string; path: string; content: Buffer }[] {
  let testRealm = new RealmPaths(new URL(testRealmUrl));
  return (bundle.expectedChangedCards ?? []).map((id) => {
    let local = localPath(id, bundle.realmUrl);
    let path = `${local}.json`;
    let file = bundle.files.find((f) => f.path === path);
    if (!file) {
      throw new Error(`the bundle has no seed for ${path}`);
    }
    return {
      cardId: testRealm.fileURL(local).href,
      path,
      content: Buffer.from(file.content, 'base64'),
    };
  });
}
