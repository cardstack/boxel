import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

export const realmIframeSandboxProtocol = 'boxel-realm-iframe-v1' as const;

export interface RealmIframeSandboxConnect {
  protocol: typeof realmIframeSandboxProtocol;
  type: 'connect';
  document?: LooseSingleCardDocument;
  draft?: RealmIframeSandboxDraft;
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
}

export interface RealmIframeSandboxListening {
  protocol: typeof realmIframeSandboxProtocol;
  type: 'listening';
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
    body: string | null;
    headers: [string, string][];
    status: number;
    statusText: string;
    url: string;
  };
  error?: string;
}

export type RealmIframeSandboxOutbound =
  | RealmIframeSandboxListening
  | RealmIframeSandboxReady
  | RealmIframeSandboxResize
  | RealmIframeSandboxFetchRequest;

export type RealmIframeSandboxInbound =
  | RealmIframeSandboxFetchResponse
  | RealmIframeSandboxDraft;

export function isRealmIframeSandboxConnect(
  value: unknown,
): value is RealmIframeSandboxConnect {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  let message = value as Record<string, unknown>;
  return (
    message.protocol === realmIframeSandboxProtocol &&
    message.type === 'connect'
  );
}

export function isRealmIframeSandboxOutbound(
  value: unknown,
): value is RealmIframeSandboxOutbound {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  let message = value as Record<string, unknown>;
  return (
    message.protocol === realmIframeSandboxProtocol &&
    ['listening', 'ready', 'resize', 'fetch-request'].includes(
      String(message.type),
    )
  );
}
