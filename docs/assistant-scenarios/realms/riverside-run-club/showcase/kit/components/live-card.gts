// Pretui — LiveCard: a card in the reply whose taps become intents sent to the assistant.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { CardEmbed } from './card-embed';
import type { CardEmbedFormat, CardEmbedState } from './card-embed';
import { IntentReceipt } from './intent-receipt';
import { fromBoxelIntent } from './intent-bridge';
import type { BoxelIntentDetail, IntentDelivery } from './intent-bridge';

export type IntentKind = 'choose' | 'reply' | 'ask' | 'attach' | 'tool' | 'open' | 'explore';

export interface CardIntent {
  kind: IntentKind;
  value?: string;
  label?: string;
  /** a richer payload, from a `pretui-intent` event: a form's values */
  payload?: unknown;
}

export interface LiveCardSignature {
  Args: {
    /** the intent a tap on the card sent; a returned promise holds the
     * card busy until the assistant has it */
    onIntent: (intent: CardIntent) => unknown;
    /** the intent kinds the card may send. Default: all */
    kinds?: IntentKind[];
    /** the kinds that settle the card into a record. Default choose, reply */
    settles?: IntentKind[];
    /** a settled card from history: its pick is shown and it is inert */
    settled?: CardIntent;
    /** the card is someone else's request, or a read-only transcript: no
     * intent is sent */
    readonly?: boolean;
    /** the event names it listens for besides `pretui-intent`: pass
     * ['boxel-intent'] for the Boxel kernel's cards, whose detail is
     * `{ kind, cardId, title, … }` */
    intentEvents?: string[];
    /** a settled pick can be changed: the card stays live under its
     * receipt, and a new pick replaces it */
    revisable?: boolean;
    /** CardEmbed's arguments */
    format?: CardEmbedFormat;
    width?: string;
    height?: string;
    minHeight?: string;
    maxHeight?: string;
    state?: CardEmbedState;
    label?: string;
    kind?: string;
    onOpen?: () => void;
    hat?: boolean;
  };
  Blocks: {
    /** the host's CardRenderer; its controls carry data-intent */
    default: [];
  };
  Element: HTMLDivElement;
}

const ALL: IntentKind[] = ['choose', 'reply', 'ask', 'attach', 'tool', 'open', 'explore'];

/**
 * A CardEmbed whose interactions go to the assistant. The host's card
 * marks its controls with data attributes, and nothing is wired per
 * control:
 *
 * ```hbs
 * <button data-intent='choose' data-intent-value={{@model.id}} data-intent-label={{@model.name}}>Choose</button>
 * ```
 *
 * A card can also dispatch a bubbling `pretui-intent` CustomEvent with
 * `{ kind, value, label, payload }` for a richer payload, such as a form.
 *
 * It acts once: while the intent is on its way the card is busy, and a
 * settling kind (choose, reply) turns it into a record, inert, with the
 * pick marked `data-intent-chosen` and an IntentReceipt under it. A kind
 * that does not settle (open, explore, attach) leaves it live.
 */
export class LiveCard extends Component<LiveCardSignature> {
  @tracked sending: CardIntent | undefined;
  @tracked sent: CardIntent | undefined = this.args.settled;
  @tracked failed: CardIntent | undefined;
  /** how the last settling intent arrived, when `@onIntent` says */
  @tracked arrived: IntentDelivery | undefined;
  private root: HTMLElement | undefined;

  get kinds() {
    return this.args.kinds ?? ALL;
  }
  get settles() {
    return this.args.settles ?? ['choose', 'reply'];
  }
  get isSettled() {
    return Boolean(this.sent && this.settles.includes(this.sent.kind));
  }
  get receipt(): CardIntent | undefined {
    return this.sending ?? this.failed ?? (this.isSettled ? this.sent : undefined);
  }
  get delivery(): 'sending' | 'sent' | 'drafted' | 'noted' | 'failed' {
    if (this.sending) {
      return 'sending';
    }
    if (this.failed) {
      return 'failed';
    }
    return this.arrived === 'drafted' || this.arrived === 'noted' ? this.arrived : 'sent';
  }
  get inert(): boolean {
    let settled = this.isSettled && !this.args.revisable;
    return settled || Boolean(this.sending) || this.args.readonly === true;
  }

  private async send(intent: CardIntent, target?: HTMLElement) {
    if (this.inert || !this.kinds.includes(intent.kind)) {
      return;
    }
    this.root
      ?.querySelectorAll('[data-intent-chosen]')
      .forEach((el) => this.args.revisable && el.removeAttribute('data-intent-chosen'));
    this.failed = undefined;
    let settling = this.settles.includes(intent.kind);
    if (settling) {
      this.sending = intent;
    }
    try {
      let outcome = (await this.args.onIntent(intent)) as IntentDelivery | unknown;
      if (outcome === 'failed') {
        throw new Error('not delivered');
      }
      if (settling) {
        this.arrived =
          outcome === 'drafted' || outcome === 'noted' ? outcome : 'sent';
        this.sent = intent;
        this.markChosen(target, intent);
      }
    } catch {
      if (settling) {
        this.failed = intent;
      }
    } finally {
      if (!this.isDestroying && !this.isDestroyed) {
        this.sending = undefined;
      }
    }
  }

  private markChosen(target: HTMLElement | undefined, intent: CardIntent) {
    let el =
      target ??
      (intent.value
        ? this.root?.querySelector<HTMLElement>(
            `[data-intent-value="${CSS.escape(intent.value)}"]`,
          )
        : null);
    el?.setAttribute('data-intent-chosen', 'true');
  }

  retry = () => {
    let intent = this.failed;
    if (intent) {
      this.failed = undefined;
      this.send(intent);
    }
  };

  // delegation: one listener on the frame for every [data-intent] inside
  listen = modifier((element: HTMLElement) => {
    this.root = element;
    let fromTarget = (event: Event): [CardIntent, HTMLElement] | undefined => {
      let target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-intent]',
      );
      if (!target || !element.contains(target)) {
        return undefined;
      }
      return [
        {
          kind: target.dataset['intent'] as IntentKind,
          value: target.dataset['intentValue'],
          label: target.dataset['intentLabel'] ?? target.textContent?.trim(),
        },
        target,
      ];
    };
    let onClick = (event: Event) => {
      let hit = fromTarget(event);
      if (hit) {
        event.preventDefault();
        this.send(hit[0], hit[1]);
      }
    };
    let onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      let target = event.target as HTMLElement;
      // a native button already turns Enter and Space into a click
      if (target.tagName === 'BUTTON' || target.tagName === 'A') {
        return;
      }
      let hit = fromTarget(event);
      if (hit) {
        event.preventDefault();
        this.send(hit[0], hit[1]);
      }
    };
    let onIntentEvent = (event: Event) => {
      let detail = (event as CustomEvent<CardIntent>).detail;
      if (detail?.kind) {
        this.send(detail, event.target as HTMLElement);
      }
    };
    let onBoxelIntent = (event: Event) => {
      let detail = (event as CustomEvent<BoxelIntentDetail>).detail;
      if (detail?.kind) {
        this.send(fromBoxelIntent(detail), event.target as HTMLElement);
      }
    };
    let extra = this.args.intentEvents ?? [];
    element.addEventListener('click', onClick);
    element.addEventListener('keydown', onKey);
    element.addEventListener('pretui-intent', onIntentEvent);
    for (let name of extra) {
      element.addEventListener(name, onBoxelIntent);
    }
    if (this.args.settled) {
      this.markChosen(undefined, this.args.settled);
    }
    return () => {
      element.removeEventListener('click', onClick);
      element.removeEventListener('keydown', onKey);
      element.removeEventListener('pretui-intent', onIntentEvent);
      for (let name of extra) {
        element.removeEventListener(name, onBoxelIntent);
      }
      this.root = undefined;
    };
  });

  <template>
    <div
      class='pretui-livecard'
      data-settled={{if this.isSettled 'true'}}
      data-readonly={{if @readonly 'true'}}
      data-revisable={{if @revisable 'true'}}
      aria-busy={{if this.sending 'true'}}
      data-test-pretui-live-card={{if this.isSettled 'settled' 'live'}}
      ...attributes
    >
      <div class='pretui-livecard-frame' inert={{this.inert}} {{this.listen}}>
        <CardEmbed
          @format={{@format}}
          @width={{@width}}
          @height={{@height}}
          @minHeight={{@minHeight}}
          @maxHeight={{@maxHeight}}
          @state={{@state}}
          @label={{@label}}
          @kind={{@kind}}
          @onOpen={{@onOpen}}
          @hat={{@hat}}
        >{{yield}}</CardEmbed>
      </div>
      {{#if this.receipt}}
        <IntentReceipt
          @kind={{this.receipt.kind}}
          @label={{if this.receipt.label this.receipt.label 'it'}}
          @delivery={{this.delivery}}
          @onRetry={{this.retry}}
        />
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-livecard {
          display: grid;
          gap: 6px;
          justify-items: start;
        }
        .pretui-livecard-frame {
          display: grid;
          width: 100%;
        }
        /* a settled card is a record: it quiets, and its pick stays clear */
        .pretui-livecard[data-settled]:not([data-revisable]) .pretui-livecard-frame {
          opacity: 0.85;
        }
        .pretui-livecard-frame :deep([data-intent-chosen]) {
          outline: 2px solid var(--pretui-link, var(--primary));
          outline-offset: 2px;
        }
      }
    </style>
  </template>
}
