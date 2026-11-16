import { isMarker, isBxl } from './query.ts';
import {
  OperationFailure,
  type CallApiBodyTemplate,
  type CallApiResponse,
  type CallApiSlot,
  type CallApiSlotKey,
  type CallApiSlotPlacement,
  type OperationCallApi,
  type OperationCallApiResult,
  type OperationDefinition,
  type OperationLoweringIssueCode,
  type OperationRequest,
  type OperationTemplate,
} from './types.ts';
import { ANONYMOUS_ACTOR } from './anonymous-actor.ts';
import { emitKeyUse, recordSafely, type KeyUseOutcome } from './telemetry.ts';
import { destinationCovers } from './destination-covers.ts';

export { destinationCovers };
import type { KeyReadiness } from './capability-wire.ts';
import type { JsonValue } from '../json-validation.ts';
import type { SingleCardDocument } from '../document-types.ts';
import type { CallApiMethod } from '@cardstack/base/operations';
import {
  CALL_API_KEY_KINDS,
  isCallApiKeyKind,
  type CallApiKeyKind,
} from '../call-api-key-kind.ts';

export type { CallApiKeyKind };

// ============================================================================
// callApi: a request to a service outside the realm, declared as data on a
// card and sent by the realm server.
//
// Three stages, each in the place that has what it needs:
//
//   * **Lowering** (`lowerCallApi`), when the card's module is indexed, turns
//     the declaration into an `OperationCallApi`: the request with its typed
//     references still markers and its credentials still slots, plus an index
//     of the slots. Everything about where a value may stand is judged here,
//     once, so a request that would leak a credential or let a payload choose
//     a path is stored invalid and never sent.
//   * **Building** (`buildCallApiRequest`), at invocation, fills the markers
//     from the payload, the caller, the target's indexed fields and the
//     realm's settings, and encodes each value for where it lands. Each slot
//     becomes an opaque token, so the request built here holds no credential
//     and is what every record of the call describes.
//   * **Sending** belongs to the realm server's `CallApiSender`, which fills
//     the tokens after its outbound guard has checked the destination and
//     removes every credential from the response.
//
// Nothing of the card runs on any of these paths.
// ============================================================================

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

// `{{userKey}}`, `{{apiKey}}`, `{{apiKey:token}}`, `{{apiKey|basic}}`, with
// optional spaces inside the braces.
const SLOT =
  /\{\{\s*(userKey|apiKey)\s*(?::\s*([A-Za-z][A-Za-z0-9_-]*)\s*)?(?:\|\s*([A-Za-z]+)\s*)?\}\}/g;

// Text that opens like a slot. Anything between `{{` and `}}` that starts with
// a key's name is read as an attempt at one, so a misspelling is refused rather
// than sent as literal text with a credential's name in it. Other `{{…}}` text
// is the author's own — a template the vendor itself fills, say — and is sent
// as written.
const SLOT_LIKE = /\{\{\s*(?:userKey|apiKey)\b[^}]*\}\}/g;

const SLOT_TRANSFORMS = ['basic'] as const;

export interface SlotUse {
  text: string;
  name: string;
  key: CallApiSlotKey;
  transform?: 'basic';
}

// Every slot written in `text`, and every `{{…}}` that opens like one and is
// not.
export function slotsIn(text: string): {
  slots: SlotUse[];
  malformed: string[];
} {
  let slots: SlotUse[] = [];
  let malformed: string[] = [];
  for (let match of text.matchAll(SLOT_LIKE)) {
    let exact = [...match[0].matchAll(SLOT)];
    if (exact.length !== 1 || exact[0][0] !== match[0]) {
      malformed.push(match[0]);
      continue;
    }
    let [, key, name, transform] = exact[0];
    if (
      transform !== undefined &&
      !(SLOT_TRANSFORMS as readonly string[]).includes(transform)
    ) {
      malformed.push(match[0]);
      continue;
    }
    slots.push({
      text: match[0],
      key: key as CallApiSlotKey,
      name: name ?? key,
      ...(transform ? { transform: transform as 'basic' } : {}),
    });
  }
  return { slots, malformed };
}

// What a typed reference spliced into a string with `${…}` turns into. A marker
// is an object, so the splice keeps nothing of the value it stood for — and
// the author meant a value there, which is exactly what this request can't
// encode once it is text.
const SPLICED_MARKER = '[object Object]';

// ---------------------------------------------------------------------------
// Lowering
// ---------------------------------------------------------------------------

export interface CallApiIssues {
  add(code: OperationLoweringIssueCode, path: string, message: string): void;
}

// The declaration's request members, as lowering reads them off plain data.
export interface CallApiClauses {
  method?: unknown;
  url?: unknown;
  path?: unknown;
  headers?: unknown;
  query?: unknown;
  json?: unknown;
  graphql?: unknown;
  perInstance?: unknown;
  keyKind?: unknown;
}

const METHODS: readonly CallApiMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
];

// A `{name}` in a URL, the one form a path parameter takes. `{{` opens a slot
// rather than a parameter, so it is matched separately.
const PATH_PARAMETER = /(?<!\{)\{([^{}]*)\}(?!\})/g;
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// RFC 9110's token, which every header name is.
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// Lowers a `callApi` declaration's request, reporting each problem through
// `issues`. `template` lowers one value the way every other clause's values
// are lowered: it checks a `params(…)` names a declared param, and it reports a
// program where data belongs.
export function lowerCallApi(
  clauses: CallApiClauses,
  issues: CallApiIssues,
  template: (value: unknown, path: string) => OperationTemplate,
): OperationCallApi | undefined {
  let slots: (CallApiSlot & { text: string })[] = [];
  let ok = true;
  let fail = (
    code: OperationLoweringIssueCode,
    path: string,
    message: string,
  ) => {
    ok = false;
    issues.add(code, path, message);
  };

  // A value carried to invocation, with every string in it read for slots.
  // `placement` is where the value is sent, or undefined where a slot may not
  // stand at all.
  let lowerValue = (
    value: unknown,
    path: string,
    placement: CallApiSlotPlacement | undefined,
  ): OperationTemplate => {
    let lowered = template(value, path);
    // A member's name is sent as written and is never filled, so a slot in
    // one would go out as text.
    walkKeys(lowered, path, (key, at) => readSlots(key, at, undefined));
    walkStrings(lowered, path, (text, at) => {
      if (text.includes(SPLICED_MARKER)) {
        fail(
          placement === 'path' ? 'unencoded-path-parameter' : 'invalid-request',
          at,
          `\`${at}\` has a typed reference spliced into its text, which keeps nothing of the value — write the reference as the whole value${placement === 'path' ? ', so it fills the segment and is encoded as one' : ''}`,
        );
      }
      readSlots(text, at, placement);
    });
    return lowered;
  };

  let readSlots = (
    text: string,
    at: string,
    placement: CallApiSlotPlacement | undefined,
  ) => {
    let { slots: found, malformed } = slotsIn(text);
    for (let bad of malformed) {
      fail(
        'invalid-slot',
        at,
        `\`${bad}\` in \`${at}\` is not a slot — write {{userKey}} or {{apiKey}}, with an optional :name and an optional |basic`,
      );
    }
    for (let slot of found) {
      if (!placement) {
        fail(
          'slot-out-of-place',
          at,
          `\`${slot.text}\` in \`${at}\` is outside a header value, a query value, a path value and the JSON body, which are the only places a credential is filled into`,
        );
        continue;
      }
      slots.push({
        text: slot.text,
        name: slot.name,
        key: slot.key,
        ...(slot.transform ? { transform: slot.transform } : {}),
        placement,
        at,
      });
    }
  };

  // The method.
  let hasBody = clauses.json !== undefined || clauses.graphql !== undefined;
  let method: CallApiMethod = hasBody ? 'POST' : 'GET';
  if (clauses.method !== undefined) {
    if (!METHODS.includes(clauses.method as CallApiMethod)) {
      fail(
        'invalid-request',
        'method',
        `\`method\` must be one of ${METHODS.map((m) => `"${m}"`).join(', ')}`,
      );
    } else {
      method = clauses.method as CallApiMethod;
    }
  }
  if (method === 'GET' && hasBody) {
    fail('invalid-request', 'method', `a GET request carries no body`);
  }

  // The URL, and the `{name}` segments in it.
  let url = clauses.url;
  let segmentNames = new Set<string>();
  let lowered: LoweredUrl | undefined;
  if (typeof url !== 'string' || url.length === 0) {
    fail(
      'invalid-request',
      'url',
      `\`url\` must be the absolute URL the request is sent to`,
    );
  } else {
    if (url.includes(SPLICED_MARKER)) {
      fail(
        'unencoded-path-parameter',
        'url',
        `\`url\` has a typed reference spliced into its text — write the segment as \`{name}\` and fill it from \`path\`, where it is encoded as one segment`,
      );
    }
    readSlots(url, 'url', undefined);
    lowered = lowerUrlTemplate(url, fail);
    segmentNames = lowered.names;
  }

  // `path`: one encoded segment per `{name}`.
  let path: Record<string, OperationTemplate> | undefined;
  if (clauses.path !== undefined) {
    if (!isPlainObject(clauses.path)) {
      fail(
        'invalid-request',
        'path',
        `\`path\` must map each segment name to its value`,
      );
    } else {
      path = {};
      for (let [name, value] of Object.entries(clauses.path)) {
        if (!segmentNames.has(name)) {
          fail(
            'invalid-request',
            `path.${name}`,
            `\`url\` has no \`{${name}}\` segment for \`path.${name}\` to fill`,
          );
        }
        checkScalar(value, `path.${name}`, fail);
        checkLiteralSegment(value, `path.${name}`, fail);
        path[name] = lowerValue(value, `path.${name}`, 'path');
      }
    }
  }
  for (let name of segmentNames) {
    if (!path || !(name in path)) {
      fail(
        'unencoded-path-parameter',
        'url',
        `\`url\` has a \`{${name}}\` segment and \`path\` gives it no value — every segment the request fills comes from \`path\`, which encodes it`,
      );
    }
  }

  // Headers: the names are sent as written, so they hold no slot.
  let headers: Record<string, OperationTemplate> | undefined;
  if (clauses.headers !== undefined) {
    if (!isPlainObject(clauses.headers)) {
      fail(
        'invalid-request',
        'headers',
        `\`headers\` must map each header name to its value`,
      );
    } else {
      headers = {};
      for (let [name, value] of Object.entries(clauses.headers)) {
        readSlots(name, `headers`, undefined);
        if (!HEADER_NAME.test(name)) {
          fail(
            'invalid-request',
            `headers.${name}`,
            `"${name}" is not a header name`,
          );
        } else if (name.toLowerCase().startsWith('x-boxel-')) {
          fail(
            'invalid-request',
            `headers.${name}`,
            `a header named X-Boxel-* is the realm's own and is never sent to an outside service`,
          );
        }
        checkScalar(value, `headers.${name}`, fail);
        headers[name] = lowerValue(value, `headers.${name}`, 'header');
      }
    }
  }

  // The query string: the names likewise.
  let query: Record<string, OperationTemplate> | undefined;
  if (clauses.query !== undefined) {
    if (!isPlainObject(clauses.query)) {
      fail(
        'invalid-request',
        'query',
        `\`query\` must map each parameter name to its value`,
      );
    } else {
      query = {};
      for (let [name, value] of Object.entries(clauses.query)) {
        readSlots(name, 'query', undefined);
        checkScalar(value, `query.${name}`, fail);
        query[name] = lowerValue(value, `query.${name}`, 'query');
      }
    }
  }

  // The body.
  let body: CallApiBodyTemplate | undefined;
  if (clauses.json !== undefined && clauses.graphql !== undefined) {
    fail(
      'invalid-request',
      'json',
      `a request carries one body — \`json\` or \`graphql\`, not both`,
    );
  } else if (clauses.json !== undefined) {
    body = { kind: 'json', value: lowerValue(clauses.json, 'json', 'body') };
  } else if (clauses.graphql !== undefined) {
    body = lowerGraphql(clauses.graphql, fail, readSlots, lowerValue);
  }

  // Each slot once, and each name for one slot.
  let byName = new Map<string, CallApiSlot & { text: string }>();
  for (let slot of slots) {
    let seen = byName.get(slot.name);
    if (!seen) {
      byName.set(slot.name, slot);
      continue;
    }
    if (seen.key === slot.key) {
      fail(
        'slot-placed-twice',
        slot.at,
        `the "${slot.name}" slot is placed at \`${seen.at}\` and again at \`${slot.at}\` — a credential goes to one place in a request`,
      );
    } else {
      fail(
        'slot-name-reused',
        slot.at,
        `"${slot.name}" names a ${seen.key} slot at \`${seen.at}\` and a ${slot.key} slot at \`${slot.at}\` — give each slot a name of its own`,
      );
    }
  }

  // Whether each instance is approved on its own.
  if (
    clauses.perInstance !== undefined &&
    typeof clauses.perInstance !== 'boolean'
  ) {
    fail(
      'invalid-request',
      'perInstance',
      `\`perInstance\` is true, to approve each card's key on its own, or left out`,
    );
  }

  // The kind of key each slot takes, where the declaration says.
  let declaredKind = lowerKeyKind(clauses.keyKind, byName, fail);

  if (!ok || !lowered?.url || !lowered.destination) {
    return undefined;
  }
  return {
    method,
    url: lowered.url,
    destination: lowered.destination,
    ...(path ? { path } : {}),
    ...(headers ? { headers } : {}),
    ...(query ? { query } : {}),
    ...(body ? { body } : {}),
    slots: slots.map(({ text: _text, ...slot }) => {
      let keyKind = declaredKind(slot.name);
      return keyKind ? { ...slot, keyKind } : slot;
    }),
    ...(clauses.perInstance === true ? { perInstance: true as const } : {}),
  };
}

const KEY_KIND_LIST = CALL_API_KEY_KINDS.map((k) => `"${k}"`).join(', ');

// `keyKind` as declared: one kind for every slot, or a kind for each slot
// named. Answers the kind declared for a slot, by its name. A `|basic` slot
// sends the base64 of a user and password, which a minted token isn't, so it
// is declared only `static`.
function lowerKeyKind(
  keyKind: unknown,
  slots: Map<string, Pick<CallApiSlot, 'transform'>>,
  fail: (
    code: OperationLoweringIssueCode,
    path: string,
    message: string,
  ) => void,
): (slot: string) => CallApiKeyKind | undefined {
  if (keyKind === undefined) {
    return () => undefined;
  }
  let basicOnly = (kind: CallApiKeyKind, name: string, path: string) => {
    if (kind !== 'static' && slots.get(name)?.transform === 'basic') {
      fail(
        'invalid-request',
        path,
        `the "${name}" slot is sent as HTTP Basic credentials, which only a key sent as it is can be, so \`${path}\` is "static"`,
      );
      return false;
    }
    return true;
  };
  if (isCallApiKeyKind(keyKind)) {
    for (let name of slots.keys()) {
      basicOnly(keyKind, name, 'keyKind');
    }
    return () => keyKind;
  }
  if (!isPlainObject(keyKind)) {
    fail(
      'invalid-request',
      'keyKind',
      `\`keyKind\` is one of ${KEY_KIND_LIST} for every slot, or an object giving one for each slot by its name`,
    );
    return () => undefined;
  }
  let bySlot = new Map<string, CallApiKeyKind>();
  for (let [name, kind] of Object.entries(keyKind)) {
    if (!slots.has(name)) {
      fail(
        'invalid-request',
        `keyKind.${name}`,
        `the request has no "${name}" slot for \`keyKind.${name}\` to describe`,
      );
    } else if (!isCallApiKeyKind(kind)) {
      fail(
        'invalid-request',
        `keyKind.${name}`,
        `\`keyKind.${name}\` must be one of ${KEY_KIND_LIST}`,
      );
    } else if (basicOnly(kind, name, `keyKind.${name}`)) {
      bySlot.set(name, kind);
    }
  }
  return (slot) => bySlot.get(slot);
}

// The kinds of key that can fill a slot, in `CALL_API_KEY_KINDS` order: the
// one its declaration names, or else every kind that can work there. The
// realm server fills a slot with a minted access token wherever it stands, so
// only two things rule a kind out. A `|basic` slot sends the base64 of a user
// and password, which a minted token isn't. And a Google service account's
// tokens are only for Google's own services.
export function slotKeyKinds(
  slot: CallApiSlot,
  request: Pick<OperationCallApi, 'destination'>,
): CallApiKeyKind[] {
  if (slot.keyKind) {
    return [slot.keyKind];
  }
  if (slot.transform === 'basic') {
    return ['static'];
  }
  return isGoogleDestination(request.destination)
    ? [...CALL_API_KEY_KINDS]
    : ['static', 'oauth'];
}

// The domains of Google's services that take a service account's access
// tokens: its APIs, and the Firebase Realtime Database.
const GOOGLE_TOKEN_DOMAINS = ['googleapis.com', 'firebaseio.com'];

function isGoogleDestination(destination: string): boolean {
  let host: string;
  try {
    host = new URL(destination).hostname;
  } catch {
    return false;
  }
  return GOOGLE_TOKEN_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

interface LoweredUrl {
  // The `{name}` segments the URL declares.
  names: Set<string>;
  // The URL as the parser serializes it, each `{name}` segment kept as
  // written. Absent when the URL is refused.
  url?: string;
  // Where the request goes: the origin and the path up to and including the
  // last `/` before the first `{name}` segment, or the path's last `/` when it
  // has none. Absent when the URL is refused.
  destination?: string;
}

// Reads the `{name}` segments out of a URL, refusing every other way of
// putting a value in one, and lowers the URL to the parser's serialization of
// it and to its destination. Two spellings of one place —
// `https://API.example.com:443/v1/../x/` and `https://api.example.com/x/` —
// lower to the same URL and the same destination.
function lowerUrlTemplate(
  url: string,
  fail: (
    code: OperationLoweringIssueCode,
    path: string,
    message: string,
  ) => void,
): LoweredUrl {
  let names = new Set<string>();
  let ok = true;
  let refuse = (code: OperationLoweringIssueCode, message: string) => {
    ok = false;
    fail(code, 'url', message);
  };
  // Parsed with each segment stood in for by a plain one, so the URL's own
  // structure is judged as the request will have it. Each stand-in carries a
  // random part, so a URL's own text doesn't hold it (and one that does is
  // refused below), and the trailing `-` keeps one stand-in from being the
  // start of another's text.
  let parameters = [...url.matchAll(PATH_PARAMETER)];
  let nonce = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  let standInFor = (index: number) => `boxel-path-parameter-${nonce}-${index}-`;
  let standIn = url;
  for (let [index, match] of parameters.entries()) {
    standIn = standIn.replace(match[0], standInFor(index));
  }
  let parsed: URL;
  try {
    parsed = new URL(standIn);
  } catch {
    refuse('invalid-request', `\`url\` must be an absolute URL`);
    return { names };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    refuse('invalid-request', `\`url\` must be an http or https URL`);
  }
  if (parsed.username || parsed.password) {
    refuse(
      'invalid-request',
      `\`url\` carries a user name or password, which are recorded wherever the URL is — send a credential as a slot in a header instead`,
    );
  }
  // A `*` survives in a host name: Node's parser keeps it (and decodes `%2A`
  // to it), a browser's keeps it percent-encoded, so both spellings are read.
  if (/\*|%2a/i.test(parsed.hostname)) {
    refuse(
      'invalid-request',
      `\`url\` names its host with a wildcard — a request goes to one host, written out in full`,
    );
  }
  // A trailing dot names the same host as none, so one place would have two
  // destinations.
  if (parsed.hostname.endsWith('.')) {
    refuse(
      'invalid-request',
      `\`url\` names its host with a trailing dot — write the host without it`,
    );
  }
  let segments = parsed.pathname.split('/');
  let firstParameterSegment: number | undefined;
  for (let [index, match] of parameters.entries()) {
    let standInText = standInFor(index);
    let name = match[1];
    if (!PARAMETER_NAME.test(name)) {
      refuse(
        'unencoded-path-parameter',
        `\`${match[0]}\` in \`url\` is not a path segment the request can fill — write \`{name}\` and give its value in \`path\``,
      );
      continue;
    }
    let segment = segments.indexOf(standInText);
    // Each stand-in is put back where it stands, so it has to stand in exactly
    // one place in what the parser made of the URL.
    if (segment === -1 || parsed.href.split(standInText).length !== 2) {
      refuse(
        'unencoded-path-parameter',
        `\`${match[0]}\` in \`url\` is not a whole path segment — a value fills one segment entirely, so it is encoded as one; the host, the query string and part of a segment are written as they are sent`,
      );
      continue;
    }
    names.add(name);
    firstParameterSegment = Math.min(firstParameterSegment ?? segment, segment);
  }
  if (!ok) {
    return { names };
  }

  let normalized = parsed.href;
  for (let [index, match] of parameters.entries()) {
    normalized = normalized.replace(standInFor(index), match[0]);
  }
  // The pathname always opens with `/`, so the prefix always ends with one.
  let prefix =
    firstParameterSegment === undefined
      ? parsed.pathname.slice(0, parsed.pathname.lastIndexOf('/') + 1)
      : `${segments.slice(0, firstParameterSegment).join('/')}/`;
  // Set on a copy rather than resolved against the origin: a prefix that
  // opens with `//` would resolve as another host.
  let destination = new URL(parsed.href);
  destination.pathname = prefix;
  destination.search = '';
  destination.hash = '';
  return { names, url: normalized, destination: destination.href };
}

function lowerGraphql(
  graphql: unknown,
  fail: (
    code: OperationLoweringIssueCode,
    path: string,
    message: string,
  ) => void,
  readSlots: (
    text: string,
    at: string,
    placement: CallApiSlotPlacement | undefined,
  ) => void,
  lowerValue: (
    value: unknown,
    path: string,
    placement: CallApiSlotPlacement | undefined,
  ) => OperationTemplate,
): CallApiBodyTemplate | undefined {
  if (!isPlainObject(graphql)) {
    fail(
      'invalid-request',
      'graphql',
      `\`graphql\` must be an object with the \`document\` to send and its \`variables\``,
    );
    return undefined;
  }
  let { document, variables } = graphql;
  let stringBuilt = (why: string) =>
    fail(
      'string-built-graphql',
      'graphql.document',
      `\`graphql.document\` ${why} — write the document as one fixed string and pass every value it takes in \`graphql.variables\``,
    );
  if (typeof document !== 'string' || document.length === 0) {
    if (isMarker(document) || isBxl(document)) {
      stringBuilt('is computed at invocation');
    } else {
      fail(
        'invalid-request',
        'graphql.document',
        `\`graphql.document\` must be the GraphQL document to send`,
      );
    }
    return undefined;
  }
  if (document.includes(SPLICED_MARKER)) {
    stringBuilt('has a typed reference spliced into its text');
  }
  readSlots(document, 'graphql.document', undefined);
  let lowered: Record<string, OperationTemplate> | undefined;
  if (variables !== undefined) {
    if (!isPlainObject(variables)) {
      fail(
        'invalid-request',
        'graphql.variables',
        `\`graphql.variables\` must map each variable to its value`,
      );
    } else {
      lowered = {};
      for (let [name, value] of Object.entries(variables)) {
        readSlots(name, 'graphql.variables', undefined);
        lowered[name] = lowerValue(value, `graphql.variables.${name}`, 'body');
      }
    }
  }
  return {
    kind: 'graphql',
    document,
    ...(lowered ? { variables: lowered } : {}),
  };
}

// A header, query or path value is one piece of text, so a value that can only
// be an object or a list has no form to be sent in.
function checkScalar(
  value: unknown,
  path: string,
  fail: (
    code: OperationLoweringIssueCode,
    path: string,
    message: string,
  ) => void,
) {
  if (Array.isArray(value) || (isPlainObject(value) && !isMarker(value))) {
    fail(
      'invalid-request',
      path,
      `\`${path}\` is sent as text, so it is a string, a number, a boolean or a typed reference to one`,
    );
  }
}

// A path value written as text is sent as that text on every invocation, so a
// value `encodeSegment` refuses would refuse every call. It is refused here
// instead, where the declaration is what is wrong. A slot in the text is
// filled with a token of letters, digits and `_`, which changes none of the
// answers `segmentProblem` gives, so the text is judged as written.
function checkLiteralSegment(
  value: unknown,
  path: string,
  fail: (
    code: OperationLoweringIssueCode,
    path: string,
    message: string,
  ) => void,
) {
  if (typeof value !== 'string') {
    return;
  }
  let why = segmentProblem(value);
  if (why) {
    fail(
      'invalid-request',
      path,
      `\`${path}\` ${why}, so no request can send it — write a fixed part of the path into \`url\` as it is sent`,
    );
  }
}

function walkStrings(
  node: OperationTemplate,
  path: string,
  visit: (text: string, path: string) => void,
) {
  if (typeof node === 'string') {
    visit(node, path);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((entry, index) =>
      walkStrings(entry, `${path}[${index}]`, visit),
    );
    return;
  }
  if (node !== null && typeof node === 'object' && !isMarker(node)) {
    for (let [key, value] of Object.entries(
      node as Record<string, OperationTemplate>,
    )) {
      walkStrings(value, `${path}.${key}`, visit);
    }
  }
}

function walkKeys(
  node: OperationTemplate,
  path: string,
  visit: (key: string, path: string) => void,
) {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => walkKeys(entry, `${path}[${index}]`, visit));
    return;
  }
  if (node !== null && typeof node === 'object' && !isMarker(node)) {
    for (let [key, value] of Object.entries(
      node as Record<string, OperationTemplate>,
    )) {
      visit(key, path);
      walkKeys(value, `${path}.${key}`, visit);
    }
  }
}

// Whether any value the request fills reads the invoking actor.
export function callApiReadsActor(request: OperationCallApi): boolean {
  let templates: OperationTemplate[] = [
    ...Object.values(request.path ?? {}),
    ...Object.values(request.headers ?? {}),
    ...Object.values(request.query ?? {}),
  ];
  if (request.body?.kind === 'json') {
    templates.push(request.body.value);
  } else if (request.body?.variables) {
    templates.push(...Object.values(request.body.variables));
  }
  return templates.some(readsActor);
}

function readsActor(template: OperationTemplate): boolean {
  if (Array.isArray(template)) {
    return template.some(readsActor);
  }
  if (template === null || typeof template !== 'object') {
    return false;
  }
  if ((template as Record<string, unknown>).$ref === 'actor') {
    return true;
  }
  return Object.values(template).some(readsActor);
}

// ---------------------------------------------------------------------------
// Building the request at invocation
// ---------------------------------------------------------------------------

// The request a `callApi` sends, built from its declaration and one
// invocation. Every slot is a token here, so this holds no credential: it is
// the request as declared, which is what is checked and what is recorded.
export interface CallApiRequest {
  method: CallApiMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  // Each slot the request carries, with the token that stands where it goes.
  slots: (CallApiSlot & { token: string })[];
}

// A credential to fill into a request at send time.
export interface CallApiCredential {
  token: string;
  // The value exactly as it is sent, transform applied.
  value: string;
  // The value as stored, where a transform makes what is sent differ from it.
  // Removed from the response as well, since a vendor can echo either.
  raw?: string;
  // The grant the value was opened under, as `fill` reported it.
  grant?: CallApiGrantUse;
}

// The grant a slot's value was opened under, which the sender's `fill`
// reports and its `send` reads back to act on the vendor's answer: a 401
// rejects the grant, a 403 is recorded on it, and a probe the vendor accepts
// clears it. The executor carries it from one to the other unread.
export interface CallApiGrantUse {
  id: string;
  destination: string;
  slot: { name: string; key: CallApiSlot['key'] };
  realmURL: string;
  // The share the key was used through, for an `apiKey` slot.
  shareId?: string;
  // The grant's sealed copy that was opened, so a vendor's answer is held
  // against the value it was sent, not one that replaced it meanwhile.
  copy: string;
  // Whether this call is the probe of a grant the vendor rejected.
  probe: boolean;
}

// How an invocation arrived. An interactive one carries a user's session: a
// card in the browser, the AI assistant, the CLI. An automation invocation
// carries an automation run's token, and acts as the run's identity: a
// schedule's payer, or whoever started the run.
export type CallApiMode = 'interactive' | 'automation';

// What names the binding that fills a request's slots.
export interface CallApiSlotLookup {
  realmURL: string;
  // The type the operation was resolved on, and the operation's name there.
  // The binding is for this type's operation, whichever class declared it.
  type: { module: string; name: string };
  operation: string;
  // The card the operation was invoked on; absent for one invoked on the type.
  instance?: string;
  // Who the invocation acts for: the signed-in caller, or an automation's payer.
  // A `{{userKey}}` slot is filled only from this user's own binding. For a
  // caller who isn't signed in, it is `"anonymous"` (`ANONYMOUS_ACTOR`), and
  // `anonymous` says where they called from.
  caller: string;
  // Set for a caller who isn't signed in, whom the realm's policy admitted.
  // Only `{{apiKey}}` slots are filled for one, from a share whose key allows
  // anonymous use, and each call counts against the share's limit for their
  // address, their part of the share's budget, and the key's anonymous cap.
  anonymous?: AnonymousCallApiCaller;
  mode: CallApiMode;
  // The automation run an `automation` invocation belongs to.
  runId?: string;
  // The request as the definition cache holds it now, which the binding's
  // fingerprint is checked against.
  request: OperationCallApi;
}

// A caller who isn't signed in, as a `callApi` counts them: by the address
// the realm admitted them from, in the form the anonymous rate limiter counts
// it under (`rateLimitKey`).
export interface AnonymousCallApiCaller {
  address: string;
}

// What names the bindings a readiness answer is about: the same as a call's,
// for a caller invoking from a card, who may be nobody signed in. `anonymous`
// is set where the realm admitted such a caller from a known address.
export interface CallApiReadinessLookup extends Omit<
  CallApiSlotLookup,
  'caller' | 'mode'
> {
  caller: string | undefined;
}

// One slot's credential, as the binding that fills it provides it.
export interface CallApiFilledSlot {
  name: string;
  // As it is sent, transform applied.
  value: string;
  // As stored, where a transform makes `value` differ from it.
  raw?: string;
  // Where the key's owner approved it to be sent: the request, as built and
  // before anything is filled into it, must be under this destination.
  destination: string;
  grant?: CallApiGrantUse;
  // The share or personal key this slot's use is counted against, which the
  // executor hands back to the sender's `recordUse` unread.
  countsAgainst?: CallApiUseSubject;
}

// A share, or one of a user's own keys, whose use is recorded.
export interface CallApiUseSubject {
  kind: 'share' | 'key';
  id: string;
}

// One invocation's use of the shares and keys filling its slots, as the
// executor reports it to the sender once the slots are filled: how it ended,
// and for whom. A refusal raised while the slots are being filled is the
// sender's own to record, since only it knows which share or key refused.
export interface CallApiUse {
  realmURL: string;
  operation: string;
  caller: string | null;
  mode: CallApiMode;
  // The automation run an `automation` use belongs to.
  runId?: string;
  // The origin and path of the request as declared, or null when it was
  // refused before one was built.
  url: string | null;
  outcome: KeyUseOutcome;
  code?: string;
  status?: number;
  countsAgainst: CallApiUseSubject[];
}

// The realm server's side of a `callApi`. `fill` finds the binding for every
// slot a request carries and opens its key under the grant it names, or
// refuses with `binding-not-approved`, `share-suspended`,
// `binding-needs-reapproval`, `interactive-use-not-approved`,
// `anonymous-use-not-approved` or `credential-rejected`; an interactive call over its key's limits with
// `rate-limited` or `over-budget`, or `rate-limit-unavailable` when they
// couldn't be counted. `send` sends the request through the guarded
// outbound client and answers with the vendor's response, its credentials
// removed; a refusal or a failure to get any response at all is thrown as an
// `OperationFailure` carrying `guard-refused`, `upstream-timeout` or
// `response-too-large`, and a 401 to a credential as `credential-rejected`.
//
// `readiness` answers, without opening any key, whether `fill` would fill
// every slot for this caller invoking from a card, and what would fix it if
// not, or `undefined` where no approval could make it fill. A sender that
// can't tell leaves it out.
//
// `recordUse` keeps the record of each invocation that got as far as filled
// slots, against the shares and keys `fill` said they count against. It
// describes what happened and never changes it, so whatever it throws is
// logged and dropped.
export interface CallApiSender {
  fill(lookup: CallApiSlotLookup): Promise<CallApiFilledSlot[]>;
  recordUse?(use: CallApiUse): Promise<void>;
  readiness?(lookup: CallApiReadinessLookup): Promise<KeyReadiness | undefined>;
  send(
    request: CallApiRequest,
    credentials: CallApiCredential[],
    options?: CallApiSendOptions,
  ): Promise<CallApiResponse>;
}

// How an automation run's call is sent. `responseByteBudget` is the most of
// the response the call may read, besides the path's own size cap: what is
// left of the run's `responseBytes` cap. `onResponseBytes` is told how many
// bytes of the response were read, once, whether the call answered or its
// response was refused for its size, and whether it was the budget that
// refused it.
export interface CallApiSendOptions {
  responseByteBudget?: number;
  onResponseBytes?: (bytes: number, budgetReached: boolean) => void;
}

// What an automation run's admitted call may read of its response.
export interface CallApiRunAdmission {
  responseByteBudget: number;
}

// Holds an automation run's `callApi` to the automation's declaration and the
// run's caps. `checkDeclared` refuses an operation the automation doesn't
// declare on the type it was resolved on (or one whose type can't be
// resolved). `admitCall` counts the call against the run's `callApiCalls`
// cap just before it is sent, and answers what is left of its
// `responseBytes` cap; a call past either cap ends the run and is refused.
// `recordResponse` adds the bytes the call read to the run, and when the
// budget refused the response, ends the run and answers the refusal to raise
// in place of the size refusal. Each refusal is thrown as an
// `OperationFailure`.
export interface CallApiRunMeter {
  checkDeclared(
    type: { module: string; name: string } | undefined,
    operation: string,
  ): Promise<void>;
  admitCall(): Promise<CallApiRunAdmission>;
  recordResponse(
    bytes: number,
    budgetReached: boolean,
  ): Promise<ConstructorParameters<typeof OperationFailure>[0] | undefined>;
  // Writes the call's line in the run's log. It never throws.
  logCall(call: CallApiRunLogEntry): Promise<void>;
}

// One `callApi` call as a run's log records it. `url` is the request as
// built, every credential slot still a token; the log masks its query
// values. Nothing here carries a header value.
export interface CallApiRunLogEntry {
  operation: string;
  method?: string;
  url?: string;
  // The vendor's status, for a call that was answered.
  status?: number;
  // Why the call was refused or failed, for one that wasn't.
  code?: string;
  detail?: string;
  ms?: number;
  // The response bytes read.
  bytes?: number;
}

// What the request's values are filled from.
export interface CallApiValues {
  params: Record<string, unknown>;
  actor?: string;
  // The target's indexed document, for an instance target.
  instance?: SingleCardDocument;
  realmConfig: () => Promise<Record<string, JsonValue>>;
}

export async function buildCallApiRequest(
  name: string,
  request: OperationCallApi,
  values: CallApiValues,
): Promise<CallApiRequest> {
  let fill = new Filler(name, values);
  let slots: CallApiRequest['slots'] = request.slots.map((slot, index) => ({
    ...slot,
    token: slotToken(index),
  }));
  let tokenFor = (text: string, at: string): string => {
    let { slots: found } = slotsIn(text);
    let result = text;
    for (let slot of found) {
      let entry = slots.find((s) => s.at === at && s.name === slot.name);
      if (entry) {
        result = result.split(slot.text).join(entry.token);
      }
    }
    return result;
  };

  // The URL: each `{name}` segment filled with one encoded segment.
  let url = request.url;
  for (let [segment, template] of Object.entries(request.path ?? {})) {
    let value = tokenFor(
      await fill.text(template, `path.${segment}`),
      `path.${segment}`,
    );
    url = url.split(`{${segment}}`).join(encodeSegment(name, segment, value));
  }
  let target = new URL(url);
  for (let [param, template] of Object.entries(request.query ?? {})) {
    target.searchParams.append(
      param,
      tokenFor(await fill.text(template, `query.${param}`), `query.${param}`),
    );
  }

  let headers: Record<string, string> = {};
  for (let [header, template] of Object.entries(request.headers ?? {})) {
    let value = tokenFor(
      await fill.text(template, `headers.${header}`),
      `headers.${header}`,
    );
    if (/[\r\n\0]/.test(value)) {
      throw invalidValue(name, `headers.${header}`, 'holds a line break');
    }
    headers[header] = value;
  }

  let body: string | undefined;
  if (request.body) {
    let json =
      request.body.kind === 'json'
        ? await fill.json(request.body.value, 'json', tokenFor)
        : {
            query: request.body.document,
            ...(request.body.variables
              ? {
                  variables: await fill.json(
                    request.body.variables,
                    'graphql.variables',
                    tokenFor,
                  ),
                }
              : {}),
          };
    body = JSON.stringify(json);
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }
  }

  return {
    method: request.method,
    url: target.href,
    headers,
    ...(body !== undefined ? { body } : {}),
    slots,
  };
}

// Letters, digits and `_`, which percent-encoding, JSON escaping and a header
// value all leave alone, so the token reads the same wherever its slot stands.
function slotToken(index: number): string {
  let random = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return `boxel_slot_${index}_${random}`;
}

// One path segment, whatever the value holds, to the URL and to the vendor
// alike, or why a value can't be one. `encodeURIComponent` keeps a `/` from
// adding a segment to the URL as written, but a vendor that decodes `%2F` (or
// reads `%5C` as a separator) before routing would split the segment and could
// step out of the approved destination, so a value holding `/` or `\` is
// refused. A value that is a dot segment would be resolved away by the URL, so
// it is refused rather than sent somewhere else. Lowering asks the same
// question of a value written as text, so the two can't disagree.
function segmentProblem(value: string): string | undefined {
  if (value === '') {
    return 'is empty, and fills no segment';
  }
  if (value === '.' || value === '..') {
    return `is "${value}", which a URL resolves as a step through the path rather than a segment`;
  }
  if (/[/\\]/.test(value)) {
    return 'holds a path separator (`/` or `\\`), which a vendor that decodes the segment reads as more than one segment';
  }
  if (LONE_SURROGATE.test(value)) {
    return 'holds text that is not valid Unicode';
  }
  return undefined;
}

// A surrogate without its pair has no UTF-8 encoding, so `encodeURIComponent`
// throws on it.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function encodeSegment(name: string, segment: string, value: string): string {
  let why = segmentProblem(value);
  if (why) {
    throw new OperationFailure({
      status: 400,
      code: 'invalid-params',
      title: 'Invalid request value',
      detail: `the value for \`path.${segment}\` in the request operation "${name}" ${why}`,
      meta: { operation: name, path: `path.${segment}` },
    });
  }
  return encodeURIComponent(value);
}

function invalidValue(
  name: string,
  path: string,
  why: string,
): OperationFailure {
  return new OperationFailure({
    status: 400,
    code: 'invalid-params',
    title: 'Invalid request value',
    detail: `the value for \`${path}\` in the request operation "${name}" sends ${why}`,
    meta: { operation: name, path },
  });
}

// Fills typed references from one invocation's values.
class Filler {
  #config: Promise<Record<string, JsonValue>> | undefined;
  private name: string;
  private values: CallApiValues;

  constructor(name: string, values: CallApiValues) {
    this.name = name;
    this.values = values;
  }

  async text(template: OperationTemplate, path: string): Promise<string> {
    let value = await this.value(template, path);
    if (value === null || value === undefined) {
      throw invalidValue(this.name, path, 'nothing');
    }
    if (typeof value === 'object') {
      throw invalidValue(this.name, path, 'a value that is not text');
    }
    return String(value);
  }

  async json(
    template: OperationTemplate,
    path: string,
    tokenFor: (text: string, at: string) => string,
  ): Promise<unknown> {
    if (typeof template === 'string') {
      return tokenFor(template, path);
    }
    if (Array.isArray(template)) {
      let out = [];
      for (let [index, entry] of template.entries()) {
        out.push(await this.json(entry, `${path}[${index}]`, tokenFor));
      }
      return out;
    }
    if (template !== null && typeof template === 'object') {
      if (isMarker(template)) {
        return (await this.value(template, path)) ?? null;
      }
      let out: Record<string, unknown> = {};
      for (let [key, member] of Object.entries(
        template as Record<string, OperationTemplate>,
      )) {
        out[key] = await this.json(member, `${path}.${key}`, tokenFor);
      }
      return out;
    }
    return template;
  }

  async value(template: OperationTemplate, path: string): Promise<unknown> {
    if (!isMarker(template)) {
      return template;
    }
    switch (template.$ref) {
      case 'params':
        return this.values.params[String(template.key)];
      case 'actor':
        if (!this.values.actor) {
          throw new OperationFailure({
            status: 401,
            code: 'actor-required',
            title: 'Operation needs an identity',
            detail: `\`${path}\` in operation "${this.name}" reads the invoking actor, and this request authenticated nobody`,
          });
        }
        return this.values.actor;
      case 'instance': {
        let doc = this.values.instance;
        if (!doc) {
          throw new OperationFailure({
            status: 400,
            code: 'invalid-params',
            title: 'No instance in scope',
            detail: `\`${path}\` in operation "${this.name}" reads the card it is invoked on, and this invocation names a type rather than a card`,
          });
        }
        if (template.key === undefined || template.key === 'id') {
          return doc.data.id;
        }
        return readPath(doc.data.attributes ?? {}, String(template.key));
      }
      case 'realmConfig': {
        let config = await (this.#config ??= this.values.realmConfig());
        if (template.key === undefined) {
          return config;
        }
        let key = String(template.key);
        if (!Object.prototype.hasOwnProperty.call(config, key)) {
          throw new OperationFailure({
            status: 400,
            code: 'invalid-params',
            title: 'Realm setting missing',
            detail: `\`${path}\` in operation "${this.name}" reads the realm setting "${key}", and this realm configures none`,
          });
        }
        return config[key];
      }
      case 'card':
        return this.value(template.value as OperationTemplate, path);
      default:
        throw invalidValue(
          this.name,
          path,
          'a reference the request cannot fill',
        );
    }
  }
}

// A field of the indexed document by its dotted path: a contained field's own
// fields are reached the way the card's are.
function readPath(attributes: Record<string, unknown>, key: string): unknown {
  let node: unknown = attributes;
  for (let part of key.split('.')) {
    if (node === null || typeof node !== 'object') {
      return undefined;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

// ---------------------------------------------------------------------------
// Running one invocation
// ---------------------------------------------------------------------------

export interface CallApiInvocation {
  realmURL: string;
  // Whether the request this invocation arrived in is part of a render.
  duringPrerender: boolean;
  mode: CallApiMode;
  // The automation run an `automation` invocation belongs to.
  runId?: string;
  // Holds an `automation` invocation to its automation's declaration and its
  // run's caps. Every `automation` invocation carries one.
  runMeter?: CallApiRunMeter;
  sender: CallApiSender | undefined;
  // Set for a request that authenticated nobody, which the realm's policy
  // admitted from this address.
  anonymous?: AnonymousCallApiCaller;
  // The type the operation resolved on, read only once a slot needs filling.
  type: () => Promise<{ module: string; name: string } | undefined>;
  // The target's indexed document, read only once the request is going to be
  // built.
  instance?: () => Promise<SingleCardDocument>;
  realmConfig: () => Promise<Record<string, JsonValue>>;
}

export async function callApiOperation(
  request: OperationRequest,
  definition: OperationDefinition,
  invocation: CallApiInvocation,
): Promise<OperationCallApiResult> {
  let declared = definition.callApi;
  let id = request.target.kind === 'instance' ? request.target.url : undefined;
  // The slots' credentials once `fill` has found them, whose shares and keys
  // each outcome from then on is recorded against.
  let filled: CallApiFilledSlot[] = [];
  // Set once the request is built and about to be sent.
  let sending: { method: string; url: string; startedAt: number } | undefined;
  let bytesRead: number | undefined;
  let logCall = (entry: Omit<CallApiRunLogEntry, 'operation'>) =>
    invocation.runMeter?.logCall({
      operation: request.name,
      ...(sending
        ? {
            method: sending.method,
            url: sending.url,
            ms: Date.now() - sending.startedAt,
          }
        : {}),
      ...(bytesRead !== undefined ? { bytes: bytesRead } : {}),
      ...entry,
    });
  let refuse = async (
    error: ConstructorParameters<typeof OperationFailure>[0],
    url?: string,
  ): Promise<never> => {
    await recordKeyUse(request, invocation, url, filled, {
      outcome: 'refused',
      code: error.code,
    });
    await logCall({
      ...(url && !sending ? { url } : {}),
      code: error.code ?? 'refused',
      ...(error.detail ? { detail: error.detail } : {}),
    });
    throw new OperationFailure({ ...(id ? { id } : {}), ...error });
  };
  if (!declared) {
    return refuse({
      status: 500,
      code: 'internal-error',
      title: 'Operation has no request',
      detail: `operation "${request.name}" is a callApi with no request stored for it`,
    });
  }
  // A render is replayed and its output shared, so nothing it runs may act on
  // the world for whoever is looking at it.
  if (invocation.duringPrerender) {
    return refuse({
      status: 403,
      code: 'not-during-render',
      title: 'Not during render',
      detail: `operation "${request.name}" sends a request to an outside service, which a card being rendered may not do`,
    });
  }
  // A caller who isn't signed in has no key of their own, so a `{{userKey}}`
  // slot can't be filled for them. A shared key can, where its owner allowed
  // anonymous use, and the share counts such callers by address, so one the
  // realm couldn't place is refused too.
  let anonymous =
    !request.actor && declared.slots.length > 0
      ? invocation.anonymous
      : undefined;
  if (declared.slots.length > 0 && !request.actor) {
    let sendsUserKey = declared.slots.some(({ key }) => key === 'userKey');
    if (sendsUserKey || !anonymous) {
      return refuse({
        status: 401,
        code: 'actor-required',
        title: 'Operation needs an identity',
        detail: sendsUserKey
          ? `operation "${request.name}" sends the invoking user's own key, and this request authenticated nobody`
          : `operation "${request.name}" sends a credential, and this request authenticated nobody`,
      });
    }
  }
  if (!invocation.sender) {
    return refuse({
      status: 501,
      code: 'internal-error',
      title: 'Operation not implemented',
      detail: `this realm sends no request to an outside service, so operation "${request.name}" cannot be carried out here`,
    });
  }
  // An automation's run may call only what the automation declares, so an
  // undeclared operation is refused before any key is looked for.
  let runMeter = invocation.runMeter;
  if (invocation.mode === 'automation') {
    if (!runMeter) {
      return refuse({
        status: 500,
        code: 'internal-error',
        title: 'Run not metered',
        detail: `operation "${request.name}" was invoked by an automation run that nothing holds to its declaration`,
      });
    }
    try {
      await runMeter.checkDeclared(await invocation.type(), request.name);
    } catch (error) {
      if (error instanceof OperationFailure) {
        return refuse(error.error);
      }
      throw error;
    }
  }
  // A slot is filled only by the key a binding names: one its owner approved
  // for this operation in this realm. The binding is found before anything is
  // built, so a request nobody approved reads nothing of the card either.
  if (declared.slots.length > 0) {
    let type = await invocation.type();
    if (!type) {
      return refuse(notApproved(request.name, declared, invocation.realmURL));
    }
    try {
      filled = await invocation.sender.fill({
        realmURL: invocation.realmURL,
        type,
        operation: request.name,
        ...(id ? { instance: id } : {}),
        caller: request.actor || ANONYMOUS_ACTOR,
        ...(anonymous ? { anonymous } : {}),
        mode: invocation.mode,
        ...(invocation.runId ? { runId: invocation.runId } : {}),
        request: declared,
      });
    } catch (error) {
      if (error instanceof OperationFailure) {
        return refuse(error.error);
      }
      throw error;
    }
  }
  let built: CallApiRequest;
  try {
    let instance = await invocation.instance?.();
    built = await buildCallApiRequest(request.name, declared, {
      params: request.params ?? {},
      ...(request.actor ? { actor: request.actor } : {}),
      ...(instance ? { instance } : {}),
      realmConfig: invocation.realmConfig,
    });
  } catch (error) {
    if (error instanceof OperationFailure) {
      return refuse(error.error);
    }
    throw error;
  }
  // Every value is encoded into a segment or the query string of the lowered
  // URL, so the built request stays under its destination; a request that
  // didn't would go somewhere nobody declared, and is not sent.
  if (!destinationCovers(declared.destination, built.url)) {
    return refuse(
      {
        status: 502,
        code: 'guard-refused',
        title: 'Destination refused',
        detail: `operation "${request.name}" built a request outside its declared destination ${declared.destination}`,
        meta: { reason: 'destination' },
      },
      built.url,
    );
  }
  // Each key is sent only under the destination its owner approved it for,
  // which the grant stored when they did. The request is checked as built,
  // with every slot still a token, so a credential in the path can't move it.
  let credentials: CallApiCredential[] = [];
  for (let slot of built.slots) {
    let fill = filled.find(({ name }) => name === slot.name);
    if (!fill) {
      return refuse(notApproved(request.name, declared, invocation.realmURL));
    }
    if (!destinationCovers(fill.destination, built.url)) {
      return refuse(
        {
          status: 502,
          code: 'guard-refused',
          title: 'Destination refused',
          detail: `operation "${request.name}" built a request outside ${fill.destination}, where the key for the credential slot "${slot.name}" was approved to be sent`,
          meta: { reason: 'destination' },
        },
        built.url,
      );
    }
    credentials.push({
      token: slot.token,
      value: fill.value,
      ...(fill.raw !== undefined ? { raw: fill.raw } : {}),
      ...(fill.grant ? { grant: fill.grant } : {}),
    });
  }
  // A run's call counts against its caps just before it is sent, so a call
  // refused before here never counts.
  let sendOptions: CallApiSendOptions | undefined;
  let responseBytes: { bytes: number; budgetReached: boolean } | undefined;
  if (runMeter) {
    let admission: CallApiRunAdmission;
    try {
      admission = await runMeter.admitCall();
    } catch (error) {
      if (error instanceof OperationFailure) {
        return refuse(error.error, built.url);
      }
      throw error;
    }
    sendOptions = {
      responseByteBudget: admission.responseByteBudget,
      onResponseBytes: (bytes, budgetReached) => {
        responseBytes = { bytes, budgetReached };
        bytesRead = bytes;
      },
    };
  }
  sending = { method: built.method, url: built.url, startedAt: Date.now() };
  let recordResponseBytes = async () =>
    runMeter && responseBytes
      ? await runMeter.recordResponse(
          responseBytes.bytes,
          responseBytes.budgetReached,
        )
      : undefined;
  let response: CallApiResponse;
  try {
    response = await invocation.sender.send(built, credentials, sendOptions);
  } catch (error) {
    let capReached = await recordResponseBytes();
    if (capReached) {
      return refuse(capReached, built.url);
    }
    if (error instanceof OperationFailure) {
      return refuse(error.error, built.url);
    }
    await recordKeyUse(request, invocation, built.url, filled, {
      outcome: 'failed',
    });
    await logCall({
      code: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  await recordResponseBytes();
  await recordKeyUse(request, invocation, built.url, filled, {
    outcome: 'sent',
    status: response.status,
  });
  await logCall({ status: response.status });
  return { callApi: response };
}

// The refusal for a slot no binding fills. The detail names each slot with
// whose key fills it, because a caller that sees only the message, such as the
// AI assistant, gets neither the code nor `meta`, and a slot's name alone
// doesn't say.
export function notApproved(
  name: string,
  declared: OperationCallApi,
  realmURL: string,
): ConstructorParameters<typeof OperationFailure>[0] {
  return {
    status: 409,
    code: 'binding-not-approved',
    title: 'Binding not approved',
    detail: `operation "${name}" sends ${describeSlots(declared.slots)}, and no binding approved for realm ${realmURL} fills ${declared.slots.length === 1 ? 'it' : 'them'}`,
    meta: { slots: declared.slots.map(({ name, key }) => ({ name, key })) },
  };
}

// Says whose key fills each slot: the invoking user's own (`userKey`) or one
// the realm holds (`apiKey`). A slot's name alone doesn't say, and this text is
// all a caller such as the AI assistant sees of the refusal.
function describeSlots(slots: CallApiSlot[]): string {
  let groups: [string, CallApiSlot[]][] = [
    ["the invoking user's own key", slots.filter((s) => s.key === 'userKey')],
    ["the realm's key", slots.filter((s) => s.key === 'apiKey')],
  ];
  return groups
    .filter(([, group]) => group.length > 0)
    .map(([whose, group]) => {
      let names = group.map(({ name }) => `"${name}"`).join(', ');
      return group.length === 1
        ? `the credential slot ${names} for ${whose}`
        : `the credential slots ${names} for ${whose}`;
    })
    .join(' and ');
}

// One line per invocation on the key-use channel, and, once slots are filled,
// the sender's record against the shares and keys filling them. The URL is the
// origin and path of the request as declared, never one a credential was
// filled into, and never its query string, which can carry a value of the
// caller's.
async function recordKeyUse(
  request: OperationRequest,
  invocation: CallApiInvocation,
  url: string | undefined,
  filled: CallApiFilledSlot[],
  outcome: { outcome: KeyUseOutcome; code?: string; status?: number },
): Promise<void> {
  let event = {
    operation: request.name,
    realm: invocation.realmURL,
    caller: request.actor || null,
    url: url ? originAndPath(url) : null,
    ...outcome,
  };
  emitKeyUse(event);
  let countsAgainst = useSubjects(filled);
  let recordUse = invocation.sender?.recordUse;
  if (!recordUse || countsAgainst.length === 0) {
    return;
  }
  try {
    await recordUse({
      realmURL: event.realm,
      operation: event.operation,
      caller: event.caller,
      mode: invocation.mode,
      ...(invocation.runId ? { runId: invocation.runId } : {}),
      url: event.url,
      ...outcome,
      countsAgainst,
    });
  } catch (e: unknown) {
    recordSafely('key use record', () => {
      throw e;
    });
  }
}

// Each share and key the filled slots count against, once: a call whose two
// slots are filled from one share is one use of it.
function useSubjects(filled: CallApiFilledSlot[]): CallApiUseSubject[] {
  let seen = new Map<string, CallApiUseSubject>();
  for (let { countsAgainst } of filled) {
    if (countsAgainst) {
      seen.set(`${countsAgainst.kind}:${countsAgainst.id}`, countsAgainst);
    }
  }
  return [...seen.values()];
}

function originAndPath(url: string): string {
  try {
    let parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(invalid URL)';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  let proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
