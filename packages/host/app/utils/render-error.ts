import {
  loadCardDef,
  type Loader,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import type { RenderError } from '@cardstack/runtime-common';

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
      if (isRenderErrorLike(parsed)) {
        return cloneRenderError(parsed);
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (typeof reason === 'object' && isRenderErrorLike(reason)) {
    return cloneRenderError(reason);
  }
  return undefined;
}

export function normalizeRenderError(
  renderError: RenderError,
  context?: RenderErrorContext,
): RenderError {
  let normalized = cloneRenderError(renderError);
  normalized = applyMissingLinkOverrides(normalized, context);
  normalized = applyAuthMessageOverrides(normalized);
  return normalized;
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
