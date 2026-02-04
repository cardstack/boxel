import type { BotTriggerEvent } from 'https://cardstack.com/base/matrix-event';

const RECOGNIZED_BOT_TRIGGER_TYPES = ['create-listing-pr'] as const;

export function isBotTriggerEvent(value: unknown): value is BotTriggerEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  let event = value as { type?: unknown; content?: unknown };
  if (event.type !== 'app.boxel.bot-trigger') {
    return false;
  }

  if (!event.content || typeof event.content !== 'object') {
    return false;
  }

  let content = event.content as { type?: unknown; input?: unknown };
  if (typeof content.type !== 'string') {
    return false;
  }

  return 'input' in content;
}

export function isBotTriggerCommand(
  value: unknown,
): value is BotTriggerEvent {
  if (!isBotTriggerEvent(value)) {
    return false;
  }
  return RECOGNIZED_BOT_TRIGGER_TYPES.includes(
    value.content.type as (typeof RECOGNIZED_BOT_TRIGGER_TYPES)[number],
  );
}
