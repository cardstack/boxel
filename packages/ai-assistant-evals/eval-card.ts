// Reads an EvaluationCard (eval-realm/evaluation.gts) into a self-contained
// bundle, and copies a bundle's initial cards and files into a fresh test
// workspace. The bundle carries the file bytes, so the browser workers, which
// run as the eval users, never need access to the workspace the evaluation
// lives in: only the writer that made the bundle does.

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
  adoptsFrom: { module: string; name: string };
}

export interface BundledFile {
  // Relative to the realm root, in both the source and the test workspace.
  path: string;
  // Base64 of the bytes.
  content: string;
  // Card instances are awaited in the index after the copy.
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
    initialCards: linkedIds(doc, 'initialCards', id),
    initialFiles: linkedIds(doc, 'initialFiles', id),
    adoptsFrom: doc.data.meta.adoptsFrom,
  };
}

function relativePath(url: string, realmUrl: string): string {
  if (!url.startsWith(realmUrl)) {
    throw new Error(
      `${url} is outside the evaluation's realm ${realmUrl}; initial cards and files must live in the same workspace as the evaluation`,
    );
  }
  return url.slice(realmUrl.length);
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
    let path = relativePath(url, evaluation.realmUrl);
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
  // Card ids in the test workspace, in the order the evaluation listed them.
  cards: string[];
  files: string[];
}

// Writes the bundle's files into the test workspace at the same path they
// had in the source, so relative references between them keep working, then
// waits for the cards to be indexed so the prompt goes out to a workspace
// that already shows them.
export async function prepopulate(
  client: RealmClient,
  bundle: EvaluationBundle,
  testRealmUrl: string,
  log: (line: string) => void = () => {},
): Promise<Prepopulated> {
  testRealmUrl = ensureTrailingSlash(testRealmUrl);
  let cards: string[] = [];
  let files: string[] = [];
  for (let file of bundle.files) {
    let url = `${testRealmUrl}${file.path}`;
    let bytes = Buffer.from(file.content, 'base64');
    if (TEXT_EXTENSIONS.test(file.path)) {
      await client.putSource(testRealmUrl, url, bytes.toString('utf8'));
    } else {
      await client.putBinary(testRealmUrl, url, new Uint8Array(bytes));
    }
    log(`copied ${file.path}`);
    if (file.isCard) {
      cards.push(url.replace(/\.json$/, ''));
    } else {
      files.push(url);
    }
  }
  // Keep the evaluation's own order for the cards, since the first ones are
  // what the runner opens in the stack.
  cards.sort(
    (a, b) =>
      bundle.initialCards.findIndex((id) =>
        a.endsWith(relativeId(id, bundle)),
      ) -
      bundle.initialCards.findIndex((id) => b.endsWith(relativeId(id, bundle))),
  );
  for (let cardId of cards) {
    await waitForCard(client, testRealmUrl, cardId);
    log(`indexed ${cardId}`);
  }
  return { cards, files };
}

function relativeId(id: string, bundle: Evaluation) {
  return id.startsWith(bundle.realmUrl) ? id.slice(bundle.realmUrl.length) : id;
}
