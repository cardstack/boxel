// Reads an EvaluationCard (eval-realm/evaluation.gts) into a self-contained
// bundle, and copies a bundle's initial cards and files into a fresh test
// workspace. The bundle carries the file bytes, so the browser workers, which
// run as the eval users, never need access to the workspace the evaluation
// lives in: only the writer that made the bundle does.

import {
  isAbsoluteIdentifier,
  lastSegmentOfIdentifier,
  resolveRRIReference,
  rri,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common/realm-identifiers';

import { evaluationSeed } from './eval-seeds/index.ts';
import {
  ensureTrailingSlash,
  realmPaths,
  waitForCard,
  type CardDocument,
  type RealmClient,
} from './realm-api.ts';

import type { AutomationApprovalTarget } from './key-seed.ts';

export interface Evaluation {
  // The EvaluationCard's id.
  url: RealmResourceIdentifier;
  realmUrl: string;
  name: string;
  prompts: string[];
  successCriteria: string;
  // Absolute ids: each link resolved against the evaluation's own id.
  initialCards: RealmResourceIdentifier[];
  initialFiles: RealmResourceIdentifier[];
  // Seeded cards the prompt asks the assistant to change, each one in
  // `initialCards` or a card `.json` in `initialFiles`. When set, every one of
  // these must differ from its seed, and only one of them, shown on screen,
  // counts as a rendered card.
  expectedChangedCards: RealmResourceIdentifier[];
  // The card each prompt is about, by position, each one in `initialCards`.
  // The runner brings it to the top of the stack before that prompt.
  promptCards: RealmResourceIdentifier[];
  // Skill features to enable in the room before the first prompt.
  skillFeatures: string[];
  // Overrides the GOOD grade's default time budget per prompt.
  secondsPerPrompt?: number;
  // Operations approved for automations only before the first prompt.
  automationApprovals: AutomationApproval[];
  // A conversation-only evaluation: the run passes when every prompt was sent
  // and nothing was written, with no card to render.
  expectsNoWrites: boolean;
  // The seed script (eval-seeds/) whose cards the run starts from. Its
  // contents are already listed in `initialFiles`, and its card lists merged
  // into the fields above.
  seedScript?: string;
  adoptsFrom: { module: string; name: string };
}

// Whose key fills the approved slots: the eval user's own key, or a share
// another user puts into the test workspace.
export type KeyFrom = 'own-key' | 'share';

export interface AutomationApproval {
  // One of `initialCards`, without its `.json` suffix; its card type is what
  // is approved.
  card: RealmResourceIdentifier;
  operation: string;
  keyFrom: KeyFrom;
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
  relativeTo: RealmResourceIdentifier,
): RealmResourceIdentifier[] {
  let relationships = doc.data.relationships ?? {};
  let ids: RealmResourceIdentifier[] = [];
  for (let [key, value] of Object.entries(relationships)) {
    if (key !== field && !key.startsWith(`${field}.`)) {
      continue;
    }
    let self = value?.links?.self;
    if (typeof self === 'string' && self) {
      ids.push(rri(resolveRRIReference(self, relativeTo)));
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
  let id = doc.data.id ?? rri(cardUrl);
  let evaluationRealmUrl = ensureTrailingSlash(
    doc.data.meta.realmURL ?? realmUrl,
  );
  let initialCards = linkedIds(doc, 'initialCards', id);
  let initialFiles = linkedIds(doc, 'initialFiles', id);
  let expectedChangedCards = linkedIds(doc, 'expectedChangedCards', id);
  let promptCards = linkedIds(doc, 'promptCards', id);
  let seedScript: string | undefined =
    typeof attributes.seedScript === 'string' && attributes.seedScript.trim()
      ? attributes.seedScript.trim()
      : undefined;
  if (seedScript) {
    let seed = evaluationSeed(seedScript);
    let realm = realmPaths(evaluationRealmUrl);
    let idOf = (path: string) => realm.fileRRI(path);
    initialFiles.push(...Object.keys(seed.contents).map(idOf));
    initialCards.push(...seed.initialCards.map(idOf));
    expectedChangedCards.push(...seed.expectedChangedCards.map(idOf));
    promptCards.push(...seed.promptCards.map(idOf));
  }
  // A card link may be spelled with its `.json` suffix, as `initialCards`
  // tolerates; the id without it is what the runner compares.
  expectedChangedCards = expectedChangedCards.map(cardIdOf);
  for (let card of expectedChangedCards) {
    if (
      !initialCards.some((seed) => cardIdOf(seed) === card) &&
      !initialFiles.includes(rri(`${card}.json`))
    ) {
      throw new Error(
        `${cardUrl} expects ${card} to change, but does not seed it in initialCards or initialFiles`,
      );
    }
  }
  promptCards = promptCards.map(cardIdOf);
  for (let card of promptCards) {
    if (!initialCards.some((seed) => cardIdOf(seed) === card)) {
      throw new Error(
        `${cardUrl} names ${card} as a prompt card, but does not open it in initialCards`,
      );
    }
  }
  let automationApprovals = automationApprovalsOf(doc, id, cardUrl);
  for (let { card } of automationApprovals) {
    if (!initialCards.some((seed) => cardIdOf(seed) === card)) {
      throw new Error(
        `${cardUrl} approves an operation of ${card}, but does not seed it in initialCards`,
      );
    }
  }
  return {
    url: id,
    realmUrl: evaluationRealmUrl,
    name:
      attributes.cardInfo?.name ??
      attributes.cardTitle ??
      attributes.title ??
      (lastSegmentOfIdentifier(id) || 'evaluation'),
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
    automationApprovals,
    expectsNoWrites: attributes.expectsNoWrites === true,
    seedScript,
    adoptsFrom: doc.data.meta.adoptsFrom,
  };
}

// `automationApprovals` is a containsMany of a field whose card is a link, so
// each entry's attributes are at its position in the attribute array and its
// card is the relationship `automationApprovals.<position>.card`.
function automationApprovalsOf(
  doc: CardDocument,
  id: RealmResourceIdentifier,
  cardUrl: string,
): AutomationApproval[] {
  let entries: unknown = doc.data.attributes?.automationApprovals;
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry, position) => {
    let { operation, keyFrom } = (entry ?? {}) as Record<string, unknown>;
    let [card] = linkedIds(doc, `automationApprovals.${position}.card`, id);
    if (!card || typeof operation !== 'string' || !operation.trim()) {
      throw new Error(
        `${cardUrl} automationApprovals[${position}] names no card or no operation`,
      );
    }
    if (keyFrom !== 'own-key' && keyFrom !== 'share') {
      throw new Error(
        `${cardUrl} automationApprovals[${position}] has keyFrom ${JSON.stringify(keyFrom)}; it is "own-key" or "share"`,
      );
    }
    return { card: cardIdOf(card), operation: operation.trim(), keyFrom };
  });
}

// A card's id: the id of its instance file without the `.json` suffix.
function cardIdOf(id: RealmResourceIdentifier): RealmResourceIdentifier {
  return rri(id.replace(/\.json$/, ''));
}

// `id`'s path inside the evaluation's realm. Paths are decoded, so an id is
// rebuilt from one with `RealmPaths.fileRRI` (see `realmPaths`).
function localPath(id: RealmResourceIdentifier, realmUrl: string): string {
  let paths = realmPaths(realmUrl);
  if (!paths.inRealm(id)) {
    throw new Error(
      `${id} is outside the evaluation's realm ${realmUrl}; initial cards and files must live in the same workspace as the evaluation`,
    );
  }
  return paths.local(id);
}

// Fetches every initial file and card. A card's own module is bundled too
// when it is a relative reference the evaluation did not list, since a card
// without its definition is an error card.
export async function loadEvaluationBundle(
  client: RealmClient,
  cardUrl: string,
): Promise<EvaluationBundle> {
  let evaluation = await loadEvaluation(client, cardUrl);
  let evaluationRealm = realmPaths(evaluation.realmUrl);
  let files = new Map<string, BundledFile>();
  // A seed script's cards come from the script, not the realm, which never
  // holds them.
  let seeded = new Map<string, Uint8Array>(
    Object.entries(
      evaluation.seedScript
        ? evaluationSeed(evaluation.seedScript).contents
        : {},
    ).map(([path, doc]) => [
      path,
      new TextEncoder().encode(`${JSON.stringify(doc, null, 2)}\n`),
    ]),
  );

  let addFile = async (sourceId: RealmResourceIdentifier, isCard: boolean) => {
    let seededPath = localPath(sourceId, evaluation.realmUrl);
    let seededBody = seeded.get(seededPath);
    let { url, body } = seededBody
      ? { url: sourceId, body: seededBody }
      : await client.getSource(evaluation.realmUrl, sourceId);
    let path = localPath(rri(url), evaluation.realmUrl);
    let existing = files.get(path);
    if (!existing) {
      files.set(path, {
        path,
        content: Buffer.from(body).toString('base64'),
        isCard,
      });
    } else if (isCard) {
      // Listed as a file first (a seed's cards all are), and opened as a card.
      existing.isCard = true;
    }
    return { path, body };
  };

  for (let fileId of evaluation.initialFiles) {
    await addFile(fileId, false);
  }
  for (let id of evaluation.initialCards) {
    let jsonId = id.endsWith('.json') ? id : rri(`${id}.json`);
    let { body } = await addFile(jsonId, true);
    let parsed: CardDocument | undefined;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body)) as CardDocument;
    } catch {
      // copied verbatim; the realm reports the problem at index time
    }
    let module = parsed?.data?.meta?.adoptsFrom?.module;
    if (module && !isAbsoluteIdentifier(module)) {
      let moduleId = rri(resolveRRIReference(module, jsonId));
      if (evaluationRealm.inRealm(moduleId)) {
        await addFile(moduleId, false);
      }
    }
  }
  return { ...evaluation, files: [...files.values()] };
}

export interface Prepopulated {
  // Ids of the evaluation's `initialCards` in the test workspace, in the order
  // the evaluation listed them: the cards the runner opens.
  cards: RealmResourceIdentifier[];
  files: RealmResourceIdentifier[];
  // Every card instance copied in, `initialCards` and card `.json` files from
  // `initialFiles` alike.
  seededCards: RealmResourceIdentifier[];
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
  let testRealm = realmPaths(testRealmUrl);
  let cards: RealmResourceIdentifier[] = [];
  let files: RealmResourceIdentifier[] = [];
  let seededCards: RealmResourceIdentifier[] = [];
  for (let file of bundle.files) {
    let url = testRealm.fileURL(file.path).href;
    let id = testRealm.fileRRI(file.path);
    let bytes = Buffer.from(file.content, 'base64');
    if (TEXT_EXTENSIONS.test(file.path)) {
      await client.putSource(testRealmUrl, url, bytes.toString('utf8'));
    } else {
      await client.putBinary(testRealmUrl, url, new Uint8Array(bytes));
    }
    log(`copied ${file.path}`);
    if (file.isCard) {
      cards.push(cardIdOf(id));
    } else {
      files.push(id);
    }
    if (file.isCard || isCardInstance(file.path, bytes)) {
      seededCards.push(cardIdOf(id));
    }
  }
  // Keep the evaluation's own order for the cards, since the first ones are
  // what the runner opens in the stack.
  let order = bundle.initialCards.map((id) =>
    localPath(cardIdOf(id), bundle.realmUrl),
  );
  let position = (id: RealmResourceIdentifier) =>
    order.indexOf(localPath(id, testRealmUrl));
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
): RealmResourceIdentifier[] {
  let testRealm = realmPaths(testRealmUrl);
  return (bundle.promptCards ?? []).map((id) =>
    testRealm.fileRRI(localPath(id, bundle.realmUrl)),
  );
}

// Each automation approval as the test workspace names it: the card type of the
// copied card, read from the seed's `adoptsFrom`, which a relative module
// reference resolves against the copy's own id.
export function automationApprovalTargets(
  bundle: EvaluationBundle,
  testRealmUrl: string,
): AutomationApprovalTarget[] {
  testRealmUrl = ensureTrailingSlash(testRealmUrl);
  let testRealm = realmPaths(testRealmUrl);
  return (bundle.automationApprovals ?? []).map(
    ({ card, operation, keyFrom }) => {
      let path = `${localPath(card, bundle.realmUrl)}.json`;
      let file = bundle.files.find((f) => f.path === path);
      if (!file) {
        throw new Error(`the bundle has no seed for ${path}`);
      }
      let doc = JSON.parse(
        Buffer.from(file.content, 'base64').toString('utf8'),
      ) as CardDocument;
      let adoptsFrom = doc.data.meta.adoptsFrom;
      let copy = testRealm.fileRRI(path);
      // A relative module was copied beside the card, so it resolves against
      // the copy. Any other reference (a URL, or a registered prefix such as
      // `@cardstack/catalog/…`) names a module outside the test workspace and
      // is passed on as it is, for the realm server to resolve.
      let relative = !isAbsoluteIdentifier(adoptsFrom.module);
      return {
        realm: testRealmUrl,
        module: rri(
          relative
            ? resolveRRIReference(adoptsFrom.module, copy).replace(/\.gts$/, '')
            : adoptsFrom.module,
        ),
        name: adoptsFrom.name,
        operation,
        instance: cardIdOf(copy),
        keyFrom,
      };
    },
  );
}

// The seed of every card instance the bundle copies in, `initialCards` and
// card `.json` files in `initialFiles` alike: for an evaluation that expects
// no writes, each one must still hold its seed data after the run.
export function seededCardSeeds(
  bundle: EvaluationBundle,
  testRealmUrl: string,
): { cardId: RealmResourceIdentifier; path: string; content: Buffer }[] {
  let testRealm = realmPaths(testRealmUrl);
  return bundle.files.flatMap((file) => {
    let content = Buffer.from(file.content, 'base64');
    if (!file.isCard && !isCardInstance(file.path, content)) {
      return [];
    }
    return [
      {
        cardId: cardIdOf(testRealm.fileRRI(file.path)),
        path: file.path,
        content,
      },
    ];
  });
}

// The seed of each card the evaluation expects the assistant to change: its
// card id in the test workspace and the bytes it started with.
export function expectedChangedSeeds(
  bundle: EvaluationBundle,
  testRealmUrl: string,
): { cardId: RealmResourceIdentifier; path: string; content: Buffer }[] {
  let testRealm = realmPaths(testRealmUrl);
  return (bundle.expectedChangedCards ?? []).map((id) => {
    let local = localPath(id, bundle.realmUrl);
    let path = `${local}.json`;
    let file = bundle.files.find((f) => f.path === path);
    if (!file) {
      throw new Error(`the bundle has no seed for ${path}`);
    }
    return {
      cardId: testRealm.fileRRI(local),
      path,
      content: Buffer.from(file.content, 'base64'),
    };
  });
}
