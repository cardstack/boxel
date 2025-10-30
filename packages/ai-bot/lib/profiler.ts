import { logger } from '@cardstack/runtime-common';

let log = logger('ai-bot');

const PROF_ENABLED = Boolean(process.env.AI_BOT_PROF);

type Label = string;
type EventId = string;

const starts: Map<EventId, Map<Label, number>> = new Map();

function ensure(eventId: EventId) {
  if (!starts.has(eventId)) starts.set(eventId, new Map());
  return starts.get(eventId)!;
}

export function profEnabled() {
  return PROF_ENABLED;
}

export function profMark(eventId: EventId, label: Label) {
  if (!PROF_ENABLED) return;
  ensure(eventId).set(label, Date.now());
}

export function profEnd(
  eventId: EventId,
  label: Label,
  extra?: Record<string, unknown>,
) {
  if (!PROF_ENABLED) return;
  let map = ensure(eventId);
  let start = map.get(label);
  let dur = start != null ? Date.now() - start : undefined;
  log.info(
    `[prof ${eventId}] ${label} ${dur != null ? dur + 'ms' : ''}`,
    extra,
  );
}

export async function profTime<T>(
  eventId: EventId,
  label: Label,
  fn: () => Promise<T>,
  extraStart?: Record<string, unknown>,
): Promise<T> {
  if (!PROF_ENABLED) return await fn();
  profMark(eventId, label);
  try {
    return await fn();
  } finally {
    profEnd(eventId, label, extraStart);
  }
}

export function profNote(
  eventId: EventId,
  label: Label,
  extra?: Record<string, unknown>,
) {
  if (!PROF_ENABLED) return;
  log.info(`[prof ${eventId}] ${label}`, extra);
}
