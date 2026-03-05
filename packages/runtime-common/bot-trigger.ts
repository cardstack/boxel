import type { BotTriggerEvent } from '@cardstack/base/matrix-event';
import { BOT_TRIGGER_EVENT_TYPE } from './matrix-constants';

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

  let content = event.content as {
    type?: string;
    input?: Record<string, unknown>;
    realm?: string;
    userId?: string;
  };
  if (typeof content.type !== 'string') {
    return false;
  }

  if (typeof content.realm !== 'string') {
    return false;
  }

  if (typeof content.userId !== 'string') {
    return false;
  }

  return 'input' in content;
}
