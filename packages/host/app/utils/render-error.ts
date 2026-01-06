import {
  loadCardDef,
  type Loader,
  type LooseSingleCardDocument,
  isCardError,
  type RenderError,
  trimExecutableExtension,
} from '@cardstack/runtime-common';
import {
  CardError,
  isCardErrorJSONAPI,
  serializableError,
} from '@cardstack/runtime-common/error';

import type { CardDef } from 'https://cardstack.com/base/card-api';

export interface RenderErrorContext {
  cardId?: string;
  normalizeCardId?(id: string): string;
}

export function isRenderErrorLike(value: unknown): value is RenderError {
  return (
    !!value &&
    typeof value === 'object' &&
    'error' in (value as Record<string, unknown>)
  );
}

export function coerceRenderError(reason: unknown): RenderError | undefined {
  if (!reason) {
    return undefined;
  }

  if (typeof reason === 'string') {
    try {
      let parsed = JSON.parse(reason);
      return coerceRenderError(parsed);
    } catch {
      return undefined;
    }
  }

  if (typeof reason === 'object') {
    if (isRenderErrorLike(reason)) {
      return cloneRenderError(reason);
    }
    if ('errors' in (reason as Record<string, unknown>)) {
      let errors = (reason as any).errors;
      if (Array.isArray(errors) && errors.length > 0) {
        let cardError = coerceCardError(errors[0]);
        if (cardError) {
          return {
            type: 'instance-error',
            error: serializableError(cardError),
          };
        }
      }
    }
    let cardError = coerceCardError(reason);
    if (cardError) {
      return { type: 'instance-error', error: serializableError(cardError) };
    }
  }
  return undefined;
}

export function normalizeRenderError(
  renderError: RenderError,
  context?: RenderErrorContext,
): RenderError {
  let normalized = cloneRenderError(renderError);
  normalized = hoistPrimaryCardError(normalized, {
    instanceId: context?.cardId,
    moduleUrl: resolveModuleUrl(context?.cardId),
  });
  normalized = applyAuthMessageOverrides(normalized);
  return applyMissingLinkOverrides(normalized, context);
}

function applyMissingLinkOverrides(
  renderError: RenderError,
  context?: RenderErrorContext,
): RenderError {
  if (renderError.error.status !== 404) {
    return renderError;
  }
  let message = renderError.error.message ?? '';
  if (typeof message !== 'string') {
    return renderError;
  }
  let errorId = renderError.error.id ?? extractMissingRefFromMessage(message);
  if (!errorId) {
    return renderError;
  }
  let normalizedErrorId = normalizeId(errorId, context);
  let normalizedContextId = context?.cardId
    ? normalizeId(context.cardId, context)
    : undefined;
  if (normalizedContextId && normalizedErrorId === normalizedContextId) {
    renderError.error.id = errorId;
    return renderError;
  }
  renderError.error.id = errorId;
  renderError.error.title = 'Link Not Found';
  renderError.error.message = `missing file ${errorId}`;
  return renderError;
}

function applyAuthMessageOverrides(renderError: RenderError): RenderError {
  let message = renderError.error.message;
  if (
    typeof message === 'string' &&
    message.trim().endsWith('Missing Authorization header')
  ) {
    renderError.error.message = message.replace(
      /Missing Authorization header\s*$/,
      'No authorized access - 401',
    );
  }
  return renderError;
}

function extractMissingRefFromMessage(message: string): string | undefined {
  let match = /^missing file (.+?)(?: not found)?$/i.exec(message.trim());
  if (match?.[1]) {
    let ref = match[1].trim();
    if (!ref.endsWith('.json')) {
      ref = `${ref}.json`;
    }
    return ref;
  }
  return undefined;
}

function normalizeId(id: string, context?: RenderErrorContext): string {
  if (context?.normalizeCardId) {
    return context.normalizeCardId(id);
  }
  try {
    let decoded = decodeURIComponent(id);
    return decoded.replace(/\.json$/, '');
  } catch {
    return id.replace(/\.json$/, '');
  }
}

function cloneRenderError<T extends RenderError>(renderError: T): T {
  return JSON.parse(JSON.stringify(renderError));
}

function coerceCardError(value: any): CardError | undefined {
  if (isCardError(value)) {
    return CardError.fromSerializableError(value);
  }
  if (isCardErrorJSONAPI(value)) {
    return CardError.fromCardErrorJsonAPI(value, value.id, value.status);
  }
  // TODO I'm skeptical it could be anything else...
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as any).status === 'number' &&
    typeof (value as any).message === 'string'
  ) {
    let err = new CardError((value as any).message, {
      status: (value as any).status,
      title: (value as any).title,
      id: (value as any).id,
    });
    if (Array.isArray((value as any).deps)) {
      err.deps = (value as any).deps;
    }
    if (typeof (value as any).stack === 'string') {
      err.stack = (value as any).stack;
    }
    if ((value as any).additionalErrors) {
      err.additionalErrors = (value as any).additionalErrors;
    }
    return err;
  }
  return undefined;
}

export type CardRenderContext = {
  cardId?: string;
  nonce?: string;
};

function contextKey({ cardId, nonce }: CardRenderContext): string {
  return `${cardId ?? ''}|${nonce ?? ''}`;
}

export class RenderCardTypeTracker {
  #cardTypes = new Map<string, string>();

  get(context: CardRenderContext) {
    return this.#cardTypes.get(contextKey(context));
  }

  set(context: CardRenderContext, cardType?: string) {
    let key = contextKey(context);
    if (!cardType) {
      this.#cardTypes.delete(key);
    } else {
      this.#cardTypes.set(key, cardType);
    }
  }

  clear() {
    this.#cardTypes.clear();
  }
}

export function friendlyCardType(card: typeof CardDef): string {
  return card.displayName === 'Card' ? card.name : card.displayName;
}

export function mergeDeps(
  ...depLists: (string[] | undefined)[]
): string[] | undefined {
  let merged = new Set<string>();
  for (let list of depLists) {
    if (!list) {
      continue;
    }
    for (let dep of list) {
      merged.add(dep);
    }
  }
  return merged.size ? [...merged] : undefined;
}

export function resolveModuleUrl(
  candidate?: string | null,
): string | undefined {
  if (!candidate) {
    return undefined;
  }
  if (candidate.endsWith('.json')) {
    return candidate.replace(/\.json$/, '.gts');
  }
  return candidate;
}

export function ensureMessageIncludesUrl(
  message: string,
  url?: string,
): string {
  if (!url) {
    return message;
  }
  if (message && message.includes(url)) {
    return message;
  }
  return message ? `${message} (${url})` : url;
}

export function hoistPrimaryCardError(
  renderError: RenderError,
  options?: {
    instanceId?: string | null;
    moduleUrl?: string | null;
    deps?: string[];
  },
): RenderError {
  let baseError = renderError.error;
  let { instanceId, moduleUrl, deps = [] } = options ?? {};
  let moduleFromDeps =
    Array.isArray(baseError.deps) && baseError.deps.length > 0
      ? resolveModuleUrl(baseError.deps[0])
      : undefined;
  let moduleFromId =
    typeof baseError.id === 'string' && baseError.id.endsWith('.json')
      ? baseError.id.replace(/\.json$/, '.gts')
      : typeof baseError.id === 'string'
        ? baseError.id
        : undefined;
  let resolvedModuleURL =
    resolveModuleUrl(moduleUrl) ?? moduleFromDeps ?? moduleFromId;
  let mergedBaseDeps = mergeDeps(
    baseError.deps,
    deps,
    resolvedModuleURL ? [resolvedModuleURL] : undefined,
  );
  let filteredBaseDeps = stripSelfDeps(
    mergedBaseDeps,
    resolvedModuleURL,
    instanceId ?? baseError.id,
  );
  let urlForMessage = resolvedModuleURL;

  if (baseError.status === 406) {
    let primary = { ...baseError };
    let nestedCardError = baseError.additionalErrors?.find((err) =>
      isCardError(err),
    );
    if (nestedCardError) {
      let nested = CardError.fromSerializableError(nestedCardError);
      primary.message =
        nested.message ?? primary.message ?? 'Module transpilation failed';
      primary.title = nested.title ?? primary.title;
      primary.stack = primary.stack ?? nested.stack;
    }
    return {
      ...renderError,
      error: {
        ...primary,
        ...(filteredBaseDeps ? { deps: filteredBaseDeps } : {}),
        message: ensureMessageIncludesUrl(
          String(primary.message ?? ''),
          urlForMessage,
        ),
        additionalErrors: null,
      },
    };
  }

  let additionalErrors = baseError.additionalErrors ?? [];
  let hoisted = additionalErrors.find(
    (err) => isCardError(err) && err.status === 406,
  );

  if (!hoisted) {
    return {
      ...renderError,
      error: {
        ...baseError,
        ...(filteredBaseDeps ? { deps: filteredBaseDeps } : {}),
        message: String(baseError.message ?? ''),
      },
    };
  }

  let hoistedCardError = CardError.fromSerializableError(hoisted);
  hoistedCardError.deps = stripSelfDeps(
    mergeDeps(
      hoistedCardError.deps,
      baseError.deps,
      deps,
      resolvedModuleURL ? [resolvedModuleURL] : undefined,
    ),
    resolvedModuleURL,
    instanceId ?? baseError.id,
  );
  let hoistMessageUrl =
    urlForMessage ??
    (typeof hoistedCardError.id === 'string'
      ? resolveModuleUrl(hoistedCardError.id)
      : undefined) ??
    (typeof baseError.id === 'string'
      ? resolveModuleUrl(baseError.id)
      : undefined) ??
    undefined;
  hoistedCardError.message = ensureMessageIncludesUrl(
    String(hoistedCardError.message ?? ''),
    hoistMessageUrl,
  );

  let remainingAdditional = additionalErrors.filter((err) => err !== hoisted);
  let serializedHoisted = serializableError(hoistedCardError);
  let serializedBase = serializableError(baseError);
  let mergedAdditional = [
    serializedBase,
    ...remainingAdditional.map((err) => serializableError(err)),
  ].filter(Boolean);

  return {
    ...renderError,
    error: {
      ...serializedHoisted,
      additionalErrors: mergedAdditional.length ? mergedAdditional : null,
    },
  };
}

export function stripSelfDeps(
  deps: string[] | undefined,
  moduleURL?: string | null,
  baseId?: string | null,
): string[] | undefined {
  if (!deps) {
    return undefined;
  }

  let normalize = (value?: string | null): string | undefined => {
    if (!value) {
      return undefined;
    }
    try {
      return trimExecutableExtension(new URL(value)).href;
    } catch (_e) {
      if (moduleURL) {
        try {
          return trimExecutableExtension(new URL(value, moduleURL)).href;
        } catch (_e2) {
          return value;
        }
      }
      return value;
    }
  };

  let selfCandidates = new Set<string>();
  let moduleSansExt = normalize(moduleURL);
  let baseSansExt = normalize(baseId);

  if (moduleURL) {
    selfCandidates.add(moduleURL);
    if (moduleSansExt) {
      selfCandidates.add(moduleSansExt);
    }
  }
  if (baseId) {
    selfCandidates.add(baseId);
    if (baseSansExt) {
      selfCandidates.add(baseSansExt);
    }
  }

  let filtered = deps
    .map((dep) => normalize(dep) ?? dep)
    .filter((dep) => !selfCandidates.has(dep));
  return filtered.length ? filtered : undefined;
}

export async function deriveCardTypeFromDoc(
  doc: LooseSingleCardDocument,
  cardURL: string,
  loader: Loader,
): Promise<string | undefined> {
  let adoptsFrom = doc.data?.meta?.adoptsFrom;
  if (!adoptsFrom) {
    return undefined;
  }
  let cardDef = await loadCardDef(adoptsFrom, {
    loader,
    relativeTo: new URL(cardURL),
  });
  return friendlyCardType(cardDef as typeof CardDef);
}

export function withCardType<T extends object>(
  payload: T,
  cardType?: string,
): T & { cardType?: string } {
  if (!cardType || 'cardType' in (payload as Record<string, unknown>)) {
    return payload as T & { cardType?: string };
  }
  return {
    ...(payload as object),
    cardType,
  } as T & { cardType?: string };
}
