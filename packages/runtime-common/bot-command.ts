import {
  BOT_TRIGGER_COMMAND_TYPES,
  BOT_TRIGGER_EVENT_TYPE,
} from './matrix-constants';

export interface BotCommandMatrixFilter {
  type: 'matrix-event';
  event_type: typeof BOT_TRIGGER_EVENT_TYPE;
  content_type: (typeof BOT_TRIGGER_COMMAND_TYPES)[number];
}

export type BotCommandFilter = BotCommandMatrixFilter;

export function isBotCommandFilter(value: unknown): value is BotCommandFilter {
  if (!value || typeof value !== 'object') {
    return false;
  }

  let filter = value as {
    type?: unknown;
    event_type?: unknown;
    content_type?: unknown;
  };

  if (filter.type !== 'matrix-event') {
    return false;
  }

  if (filter.event_type !== BOT_TRIGGER_EVENT_TYPE) {
    return false;
  }

  if (typeof filter.content_type !== 'string') {
    return false;
  }

  return BOT_TRIGGER_COMMAND_TYPES.includes(
    filter.content_type as (typeof BOT_TRIGGER_COMMAND_TYPES)[number],
  );
}

export function assertIsBotCommandFilter(
  value: unknown,
): asserts value is BotCommandFilter {
  if (!value || typeof value !== 'object') {
    throw new Error('filter must be an object');
  }

  let filter = value as {
    type?: unknown;
    event_type?: unknown;
    content_type?: unknown;
  };

  if (filter.type !== 'matrix-event') {
    throw new Error(`filter.type must be 'matrix-event'`);
  }

  if (filter.event_type !== BOT_TRIGGER_EVENT_TYPE) {
    throw new Error(`filter.event_type must be '${BOT_TRIGGER_EVENT_TYPE}'`);
  }

  if (typeof filter.content_type !== 'string') {
    throw new Error('filter.content_type must be a string');
  }

  if (
    !BOT_TRIGGER_COMMAND_TYPES.includes(
      filter.content_type as (typeof BOT_TRIGGER_COMMAND_TYPES)[number],
    )
  ) {
    throw new Error('filter.content_type is not supported');
  }
}
