import {
  BOT_TRIGGER_EVENT_TYPE,
  BOT_TRIGGER_COMMAND_TYPES,
  type BotTriggerEvent,
} from 'https://cardstack.com/base/matrix-event';

export function isBotTriggerEvent(value: unknown): value is BotTriggerEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  let event = value as { type?: unknown; content?: unknown };
  if (event.type !== BOT_TRIGGER_EVENT_TYPE) {
    return false;
  }

  if (!event.content || typeof event.content !== 'object') {
    return false;
  }

  let content = event.content as { type?: unknown; input?: unknown };
  if (typeof content.type !== 'string') {
    return false;
  }

  if (
    !BOT_TRIGGER_COMMAND_TYPES.includes(
      content.type as (typeof BOT_TRIGGER_COMMAND_TYPES)[number],
    )
  ) {
    return false;
  }

  return 'input' in content;
}
