import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import type { ResolvedCodeRef } from '@cardstack/runtime-common';

import type { Format } from '@cardstack/base/card-api';

export const realmIframeSandboxProtocol = 'boxel-realm-iframe-v1' as const;

export interface RealmIframeSandboxConnect {
  protocol: typeof realmIframeSandboxProtocol;
  type: 'connect';
  document?: LooseSingleCardDocument;
  draft?: RealmIframeSandboxDraft;
  rootModuleURL: string;
  presentation: RealmIframeSandboxPresentation;
  canWrite: boolean;
}

export interface RealmIframeSandboxPresentation {
  format: Format;
  fieldName?: string;
  codeRef?: ResolvedCodeRef;
  displayContainer: boolean;
}

export interface RealmIframeSandboxRenderUpdate {
  protocol: typeof realmIframeSandboxProtocol;
  type: 'render';
  presentation: RealmIframeSandboxPresentation;
}

export interface RealmIframeSandboxDraft {
  protocol: typeof realmIframeSandboxProtocol;
  type: 'draft';
  sourceURL: string;
  source: string;
  revision: number;
}

export interface RealmIframeSandboxReady {
  protocol: typeof realmIframeSandboxProtocol;
  type: 'ready';
  cardID?: string;
  revision?: number;
  error?: string;
  typePresentation?: RealmIframeSandboxTypePresentation;
}

// Presentation metadata is discovered by the isolated runtime after it has
// loaded the real card definition. It is deliberately data-only: the parent
// learns enough to size and label its trusted container without receiving the
// constructor, component, or any executable authority from the iframe.
export interface RealmIframeSandboxTypePresentation {
  displayName: string;
  headerColor: string | null;
  prefersWideFormat: boolean;
}

export interface RealmIframeSandboxListening {
  protocol: typeof realmIframeSandboxProtocol;
  type: 'listening';
  bootstrapID: string;
}

export interface RealmIframeSandboxResize {
  protocol: typeof realmIframeSandboxProtocol;
  type: 'resize';
  width: number;
  height: number;
}

export interface RealmIframeSandboxFetchRequest {
  protocol: typeof realmIframeSandboxProtocol;
  type: 'fetch-request';
  requestId: string;
  url: string;
  init: {
    method: string;
    headers: [string, string][];
  };
}

export interface RealmIframeSandboxFetchResponse {
  protocol: typeof realmIframeSandboxProtocol;
  type: 'fetch-response';
  requestId: string;
  response?: {
    body: string | ArrayBuffer | null;
    headers: [string, string][];
    status: number;
    statusText: string;
    url: string;
  };
  error?: string;
}

// The child never receives Store, realm credentials, or a write-capable
// fetch. It can only propose a fully data-only serialization of the card it
// is already rendering. The parent revalidates identity and permission before
// applying it to the canonical Store record.
export interface RealmIframeSandboxCardUpdate {
  protocol: typeof realmIframeSandboxProtocol;
  type: 'card-update';
  revision: number;
  document: LooseSingleCardDocument;
}

export interface RealmIframeSandboxCardUpdateResult {
  protocol: typeof realmIframeSandboxProtocol;
  type: 'card-update-result';
  revision: number;
  error?: string;
}

export type RealmIframeSandboxOutbound =
  | RealmIframeSandboxListening
  | RealmIframeSandboxReady
  | RealmIframeSandboxResize
  | RealmIframeSandboxFetchRequest
  | RealmIframeSandboxCardUpdate;

export type RealmIframeSandboxInbound =
  | RealmIframeSandboxFetchResponse
  | RealmIframeSandboxDraft
  | RealmIframeSandboxRenderUpdate
  | RealmIframeSandboxCardUpdateResult;

export function isRealmIframeSandboxConnect(
  value: unknown,
): value is RealmIframeSandboxConnect {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  let message = value as Record<string, unknown>;
  return (
    message.protocol === realmIframeSandboxProtocol &&
    message.type === 'connect' &&
    boundedString(message.rootModuleURL, 8_192) &&
    typeof message.canWrite === 'boolean' &&
    isRealmIframeSandboxPresentation(message.presentation)
  );
}

export function isRealmIframeSandboxInbound(
  value: unknown,
): value is RealmIframeSandboxInbound {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  let message = value as Record<string, unknown>;
  if (message.protocol !== realmIframeSandboxProtocol) {
    return false;
  }
  switch (message.type) {
    case 'draft':
      return (
        boundedString(message.sourceURL, 8_192) &&
        typeof message.source === 'string' &&
        message.source.length <= 2_000_000 &&
        typeof message.revision === 'number' &&
        Number.isSafeInteger(message.revision) &&
        message.revision >= 0
      );
    case 'render':
      return isRealmIframeSandboxPresentation(message.presentation);
    case 'fetch-response':
      return (
        boundedString(message.requestId, 256) &&
        optionalBoundedString(message.error, 8_192) &&
        (message.response === undefined ||
          isIframeFetchResponse(message.response))
      );
    case 'card-update-result':
      return (
        safeRevision(message.revision) &&
        optionalBoundedString(message.error, 8_192)
      );
    default:
      return false;
  }
}

export function isRealmIframeSandboxOutbound(
  value: unknown,
): value is RealmIframeSandboxOutbound {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  let message = value as Record<string, unknown>;
  if (message.protocol !== realmIframeSandboxProtocol) {
    return false;
  }
  switch (message.type) {
    case 'listening':
      return boundedString(message.bootstrapID, 256);
    case 'ready':
      return (
        optionalBoundedString(message.cardID, 8_192) &&
        (message.revision === undefined ||
          (typeof message.revision === 'number' &&
            Number.isSafeInteger(message.revision) &&
            message.revision >= 0)) &&
        optionalBoundedString(message.error, 8_192) &&
        (message.typePresentation === undefined ||
          isRealmIframeSandboxTypePresentation(message.typePresentation))
      );
    case 'resize':
      return finiteNumber(message.width) && finiteNumber(message.height);
    case 'fetch-request':
      return (
        boundedString(message.requestId, 256) &&
        boundedString(message.url, 8_192) &&
        isIframeFetchInit(message.init)
      );
    case 'card-update':
      return (
        safeRevision(message.revision) &&
        isBoundedCardDocument(message.document)
      );
    default:
      return false;
  }
}

function isRealmIframeSandboxTypePresentation(
  value: unknown,
): value is RealmIframeSandboxTypePresentation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  let presentation = value as Record<string, unknown>;
  return (
    boundedString(presentation.displayName, 1_024) &&
    (presentation.headerColor === null ||
      boundedString(presentation.headerColor, 128)) &&
    typeof presentation.prefersWideFormat === 'boolean'
  );
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function optionalBoundedString(
  value: unknown,
  maxLength: number,
): value is string | undefined {
  return value === undefined || boundedString(value, maxLength);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedCardDocument(
  value: unknown,
): value is LooseSingleCardDocument {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  let document = value as Record<string, unknown>;
  if (typeof document.data !== 'object' || document.data === null) {
    return false;
  }
  let data = document.data as Record<string, unknown>;
  if (
    data.type !== 'card' ||
    (data.id !== undefined && !boundedString(data.id, 8_192))
  ) {
    return false;
  }
  try {
    return JSON.stringify(value).length <= 2_000_000;
  } catch {
    return false;
  }
}

function isIframeFetchInit(
  value: unknown,
): value is RealmIframeSandboxFetchRequest['init'] {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  let init = value as Record<string, unknown>;
  return (
    boundedString(init.method, 16) &&
    Array.isArray(init.headers) &&
    init.headers.length <= 64 &&
    init.headers.every(
      (header) =>
        Array.isArray(header) &&
        header.length === 2 &&
        boundedString(header[0], 256) &&
        boundedString(header[1], 8_192),
    )
  );
}

function isRealmIframeSandboxPresentation(
  value: unknown,
): value is RealmIframeSandboxPresentation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  let presentation = value as Record<string, unknown>;
  return (
    ['isolated', 'embedded', 'edit'].includes(String(presentation.format)) &&
    typeof presentation.displayContainer === 'boolean' &&
    optionalBoundedString(presentation.fieldName, 1_024) &&
    (presentation.codeRef === undefined ||
      (typeof presentation.codeRef === 'object' &&
        presentation.codeRef !== null &&
        boundedString(
          (presentation.codeRef as Record<string, unknown>).module,
          8_192,
        ) &&
        boundedString(
          (presentation.codeRef as Record<string, unknown>).name,
          1_024,
        )))
  );
}

function isIframeFetchResponse(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  let response = value as Record<string, unknown>;
  return (
    (response.body === null ||
      (typeof response.body === 'string' &&
        response.body.length <= iframeFetchResponseLimitBytes) ||
      (response.body instanceof ArrayBuffer &&
        response.body.byteLength <= iframeFetchResponseLimitBytes)) &&
    Array.isArray(response.headers) &&
    response.headers.length <= 256 &&
    response.headers.every(
      (header) =>
        Array.isArray(header) &&
        header.length === 2 &&
        boundedString(header[0], 256) &&
        boundedString(header[1], 8_192),
    ) &&
    typeof response.status === 'number' &&
    Number.isSafeInteger(response.status) &&
    response.status >= 100 &&
    response.status <= 599 &&
    boundedString(response.statusText, 1_024) &&
    boundedString(response.url, 8_192)
  );
}

// The channel is a capability boundary, not an unbounded object transport.
// This matches the default Realm file limit and protects both the Host and the
// credentialless child from a declared dependency returning an enormous body.
export const iframeFetchResponseLimitBytes = 5 * 1024 * 1024;
