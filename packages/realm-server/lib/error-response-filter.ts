import type Koa from 'koa';
import { createErrorDisclosureFromEnv } from '@cardstack/runtime-common/error-disclosure-node';
import { Readable } from 'node:stream';

const errorKeys = new Set(['errors', 'error', 'errorDoc', 'renderError']);
const maximumErrorBytes = 1024 * 1024;
export function errorResponseFilterFromEnv(
  env: NodeJS.ProcessEnv,
): Koa.Middleware {
  let disclosure = createErrorDisclosureFromEnv(env);
  if (!disclosure.redacted) return async (_context, next) => next();
  let redactText = disclosure.formatText;

  function isErrorRecord(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(isErrorRecord);
    if (value === null || typeof value !== 'object') return false;
    return (
      ('message' in value && typeof value.message === 'string') ||
      ('detail' in value && typeof value.detail === 'string') ||
      ('title' in value &&
        typeof value.title === 'string' &&
        'status' in value &&
        (typeof value.status === 'number' ||
          typeof value.status === 'string') &&
        /^(4|5)\d\d$/.test(String(value.status)))
    );
  }

  function redact(value: unknown, inError: boolean, root = true): boolean {
    if (Array.isArray(value)) {
      let changed = false;
      for (let [index, child] of value.entries()) {
        if (inError && typeof child === 'string') {
          let replacement = redactText(child);
          if (replacement !== child) {
            value[index] = replacement;
            changed = true;
          }
        } else changed = redact(child, inError, false) || changed;
      }
      return changed;
    }
    if (value === null || typeof value !== 'object') return false;
    let record = value as Record<string, unknown>;
    let changed = false;
    for (let [key, child] of Object.entries(record)) {
      let errorField =
        inError ||
        (errorKeys.has(key) &&
          (isErrorRecord(child) ||
            (root && (key === 'errors' || key === 'error'))));
      if (inError && key === 'stack' && typeof child === 'string') {
        delete record[key];
        changed = true;
      } else if (errorField && typeof child === 'string') {
        let redacted = redactText(child);
        if (redacted !== child) {
          record[key] = redacted;
          changed = true;
        }
      } else {
        changed = redact(child, errorField, false) || changed;
      }
    }
    return changed;
  }

  return async (context, next) => {
    try {
      await next();
    } catch (error) {
      let status =
        typeof error === 'object' && error !== null && 'status' in error
          ? error.status
          : undefined;
      context.status =
        typeof status === 'number' &&
        Number.isSafeInteger(status) &&
        status >= 400 &&
        status <= 599
          ? status
          : 500;
      context.body =
        error instanceof Error &&
        context.status < 500 &&
        'expose' in error &&
        error.expose === true
          ? error.message
          : 'Request could not be completed.';
      context.app.emit('error', error, context);
    }
    // A handler that wrote straight to the socket (the proxy forwards an
    // upstream body as it arrives) has already answered; a body set now would
    // be appended after the one the client received.
    if (context.headerSent) return;
    let isError = context.status >= 400;
    if (!isError && !context.type.includes('json')) return;
    let body: unknown = context.body;
    let text: string | undefined;
    if (typeof body === 'string') text = body;
    else if (Buffer.isBuffer(body)) text = body.toString('utf8');
    else if (
      body !== null &&
      typeof body === 'object' &&
      !(body instanceof Readable)
    )
      text = JSON.stringify(body);
    if (text === undefined) {
      if (!isError) return;
      if (body instanceof Readable) body.destroy();
      if (!context.type.includes('json')) context.type = 'text/plain';
      text = context.type.includes('json')
        ? JSON.stringify({
            errors: [{ detail: 'Request could not be completed.' }],
          })
        : 'Request could not be completed.';
    }
    if (!isError && !/"(?:errors|error|errorDoc|renderError)"\s*:/.test(text))
      return;
    let replacement = text;
    if (isError && Buffer.byteLength(text) > maximumErrorBytes) {
      context.status = 500;
      context.type = 'application/json';
      replacement = JSON.stringify({
        errors: [
          { status: '500', title: 'Error details exceeded the response limit' },
        ],
      });
    } else {
      try {
        let document: unknown = JSON.parse(text);
        if (isError && typeof document === 'string')
          replacement = JSON.stringify(redactText(document));
        else if (redact(document, isError))
          replacement = JSON.stringify(document);
      } catch {
        if (isError) replacement = redactText(text);
      }
    }
    if (replacement !== text || text !== body) {
      context.body = replacement;
      context.remove('ETag');
      context.length = Buffer.byteLength(replacement);
    }
  };
}
