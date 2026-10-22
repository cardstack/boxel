// Pretui — IntentBridge: a card's tap, delivered by the best channel a host offers.
//
// A LiveCard hands its intents to `@onIntent`. Inside an MCP App iframe there
// is no assistant panel to hand them to: the iframe talks to the MCP host
// through a few channels, and a tap goes by the best one that exists:
//
//   1. an app-only server tool (the call the card means: submit a choice,
//      save a field), when the intent names one;
//   2. a chat message from the reader (`sendMessage`), when the host takes
//      messages; it may send it, or only draft it into the composer;
//   3. the model's context alone (`updateModelContext`), so the assistant
//      knows on the reader's next turn.
//
// The context is always written first, so the tap is on record even if a
// message never settles, and taps are delivered one at a time. The result
// is what IntentReceipt says: sent, drafted, noted, or failed.
//
// No SDK is imported here: the iframe's own code wraps its `App` in an
// `IntentChannels` object, so Pret UI vendors nothing.

import type { CardIntent, IntentKind } from './live-card';

export type IntentDelivery = 'sent' | 'drafted' | 'noted' | 'failed';

export interface IntentChannels {
  /** call an app-only server tool; reject or return `{ isError: true }` on
   * failure */
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** post a message as the reader. Resolve to 'sent', or to 'drafted' when
   * the host only put it in the composer */
  sendMessage?: (text: string) => Promise<'sent' | 'drafted' | void>;
  /** tell the model without speaking in the chat */
  updateContext?: (text: string) => Promise<unknown>;
}

/** the shape the Boxel kernel's cards dispatch as `boxel-intent` */
export interface BoxelIntentDetail {
  kind: string;
  cardId?: string;
  title?: string;
  summary?: string;
  letter?: string;
  key?: string;
  label?: string;
  text?: string;
  url?: string;
  mode?: string;
  arguments?: Record<string, unknown>;
  [key: string]: unknown;
}

const KINDS: string[] = [
  'choose',
  'reply',
  'ask',
  'attach',
  'tool',
  'open',
  'explore',
];

/** a `boxel-intent` detail as a LiveCard intent: the card id is the value,
 * its title or label the label, and the rest rides in the payload. Kinds
 * a LiveCard does not know (open-link, download, display, …) come through
 * as 'open', which never settles a card */
export function fromBoxelIntent(detail: BoxelIntentDetail): CardIntent {
  let kind = (KINDS.includes(detail.kind) ? detail.kind : 'open') as IntentKind;
  return {
    kind,
    value: detail.key ?? detail.cardId ?? detail.url,
    label: detail.label ?? detail.title ?? detail.text ?? detail.cardId,
    payload: detail,
  };
}

/** what the reader did, in their own words, for a message or the context */
export function intentText(intent: CardIntent): string {
  let what = intent.label ?? intent.value ?? 'that';
  switch (intent.kind) {
    case 'choose':
      return `I'll take ${what}.`;
    case 'reply':
      return String(what);
    case 'ask':
      return String(what);
    case 'attach':
      return `Attached ${what}.`;
    default:
      return `Looked at ${what}.`;
  }
}

/** the server tool an intent names, if any: `payload.tool` with
 * `payload.arguments` */
function toolOf(
  intent: CardIntent,
): { name: string; args: Record<string, unknown> } | undefined {
  let p = intent.payload as
    | { tool?: string; arguments?: Record<string, unknown> }
    | undefined;
  return intent.kind === 'tool' && p?.tool
    ? { name: p.tool, args: p.arguments ?? {} }
    : undefined;
}

let queue: Promise<unknown> = Promise.resolve();

/** deliver one intent by the best channel, after any still on their way */
export function deliverIntent(
  intent: CardIntent,
  channels: IntentChannels,
): Promise<IntentDelivery> {
  let run = async (): Promise<IntentDelivery> => {
    let text = intentText(intent);
    let noted = false;
    if (channels.updateContext) {
      try {
        await channels.updateContext(`The reader tapped: ${text}`);
        noted = true;
      } catch {
        noted = false;
      }
    }
    let tool = toolOf(intent);
    if (tool && channels.callTool) {
      try {
        let result = (await channels.callTool(tool.name, tool.args)) as
          | { isError?: boolean }
          | undefined;
        if (!result?.isError) {
          return 'sent';
        }
      } catch {
        // fall through to a message
      }
    }
    // reversible looks (open, explore) speak only to the context
    let speaks = intent.kind !== 'open' && intent.kind !== 'explore';
    if (speaks && channels.sendMessage) {
      try {
        let how = await channels.sendMessage(text);
        return how === 'drafted' ? 'drafted' : 'sent';
      } catch {
        // fall back to the context
      }
    }
    return noted ? 'noted' : 'failed';
  };
  let next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
