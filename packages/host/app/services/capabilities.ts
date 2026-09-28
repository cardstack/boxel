import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { buildWaiter } from '@ember/test-waiters';

import { TrackedMap } from 'tracked-built-ins';

import {
  CAPABILITY_CHECK_CAP,
  rri,
  SupportedMimeType,
  type CapabilityAnswer,
  type CapabilityCheck,
} from '@cardstack/runtime-common';

import type NetworkService from './network';
import type RealmService from './realm';
import type SessionService from './session';
import type { SessionParticipant } from './session';

import type { CardDef } from '@cardstack/base/card-api';

// ============================================================================
// `@context.canInvoke(operation, card)` — may this session invoke this
// operation on this card?
//
// A card author asks it where they would otherwise render a control and let
// the refusal arrive after the click. It answers the way a template needs an
// answer: synchronously, from what this session already knows, with `undefined`
// while the realm is still being asked. The first read of a pair it has no
// answer for enrols the pair; the answer lands on a tracked cell and the
// template re-reads it.
//
// The answer is advisory and nothing may treat it as authorization. The realm
// decides again when the operation is invoked, against the state as it is then
// — so a `true` here is what the answer was a moment ago, not a promise about
// the call. Hiding a control on a `false` is the whole intent; skipping the
// call on a `true` is always available and always wrong.
//
// **Coalescing is what makes the endpoint worth having.** A list of thirty
// cards each gating three controls reads ninety pairs in one render pass, and
// ninety requests would cost more than rendering all ninety controls. So a
// read enrols rather than fetches, and the enrolments made in one pass go out
// together on the microtask that follows it — after the pass, because the
// answers are what the next render reads and writing them during this one is
// what a backtracking-rerender assertion is for.
//
// The realm caps how many pairs one request may carry, so a pass that enrols
// more than the cap goes out as more than one request. The client splits
// rather than being refused: the cap bounds the work per request, and a view
// larger than one request's worth is the view's business.
// ============================================================================

const waiter = buildWaiter('capabilities:check');

// An answer as a template reads it. `undefined` is "not known": the value a
// pair has while the realm is being asked, after a request that could not be
// answered, and forever where there is nothing to ask (an unsaved card, a
// realm this session does not know, a render).
type Held = boolean | undefined;

export default class CapabilitiesService
  extends Service
  implements SessionParticipant
{
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private session: SessionService;

  // The answers, keyed by realm, operation and target together, because the
  // answer depends on all three. Tracked per key, so a pair that is answered
  // invalidates the templates that read that pair and no others. Written only
  // when an answer lands, never while a template is reading it: a read that
  // wrote here would dirty a value the same render had just consumed.
  #held: TrackedMap<string, boolean> = new TrackedMap();
  // The pairs that have been asked about and not answered yet. Untracked for
  // the same reason, since a read is what adds to it.
  #asking: Set<string> = new Set();
  // Enrolled and not yet sent, per realm — the realm is what a request is
  // addressed to, so a view spanning two realms sends two.
  #enrolled: Map<string, Map<string, CapabilityCheck>> = new Map();
  #flushing: Promise<void> | undefined;

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  // May this session invoke `operation` on `card`?
  //
  // `card` is a saved card or its URL. A card with no URL yet is not something
  // the realm can be asked about — there is no stored state for a predicate to
  // read — so it answers `undefined` and enrols nothing.
  canInvoke = (operation: string, card: CardDef | string): Held => {
    let id = typeof card === 'string' ? card : card.id;
    if (!id || !operation) {
      return undefined;
    }
    // Nothing is asked inside the dedicated prerender app, and nothing is
    // answered. That app authenticates as itself so it can render any card,
    // and its identity is not the identity of whoever is later served the HTML
    // it produces — so an answer resolved there would bake one session's
    // permissions into a rendering everyone reads. The live render that
    // follows the prerendered HTML asks for itself.
    if ((globalThis as any).__boxelPrerenderApp) {
      return undefined;
    }
    let realmURL = this.realm.realmOf(rri(id));
    if (!realmURL) {
      return undefined;
    }
    let key = `${realmURL}|${operation}|${id}`;
    // Read first, so a template that reads a pair before it is answered is
    // subscribed to the answer when it lands.
    let held = this.#held.get(key);
    if (held !== undefined) {
      return held;
    }
    if (!this.#asking.has(key)) {
      this.#asking.add(key);
      this.#enrol(realmURL, key, { target: id, operation });
    }
    return undefined;
  };

  // Every answer is session-scoped: who is asking is half the question, and a
  // pair says nothing about who asked it. So the session's end drops them all,
  // and the next read of any pair asks again as whoever signed in next.
  resetState(): void {
    this.#held.clear();
    this.#asking.clear();
    this.#enrolled.clear();
  }

  #enrol(realmURL: string, key: string, check: CapabilityCheck): void {
    let pending = this.#enrolled.get(realmURL);
    if (!pending) {
      pending = new Map();
      this.#enrolled.set(realmURL, pending);
    }
    pending.set(key, check);
    // One flush per pass, whatever enrolled during it. Scheduled on the
    // microtask queue rather than the run loop so it runs once the pass that
    // read these pairs has finished, and held under a waiter so a test settles
    // on the answers rather than on the render that has not got them yet.
    if (!this.#flushing) {
      let token = waiter.beginAsync();
      this.#flushing = Promise.resolve()
        .then(() => this.#flush())
        .finally(() => {
          this.#flushing = undefined;
          waiter.endAsync(token);
        });
    }
  }

  async #flush(): Promise<void> {
    let enrolled = [...this.#enrolled];
    this.#enrolled.clear();
    await Promise.all(
      enrolled.map(([realmURL, pending]) => this.#ask(realmURL, [...pending])),
    );
  }

  async #ask(
    realmURL: string,
    pending: [string, CapabilityCheck][],
  ): Promise<void> {
    for (let start = 0; start < pending.length; start += CAPABILITY_CHECK_CAP) {
      let chunk = pending.slice(start, start + CAPABILITY_CHECK_CAP);
      let answers = await this.#send(
        realmURL,
        chunk.map(([, check]) => check),
      );
      chunk.forEach(([key], index) => {
        this.#asking.delete(key);
        // A request that failed leaves the pair unanswered rather than denied,
        // and free to be asked again by the next read of it. A denial would
        // hide a control the caller may well be able to use, when a realm that
        // could not answer has said nothing about whether they can. Nothing is
        // written for it, so the failure itself causes no re-render and no
        // retry loop: the next ask waits for something else to render.
        let answer = answers?.[index];
        if (answer) {
          this.#held.set(key, answer.allowed);
        }
      });
    }
  }

  async #send(
    realmURL: string,
    checks: CapabilityCheck[],
  ): Promise<CapabilityAnswer[] | undefined> {
    try {
      let response = await this.network.authedFetch(
        `${realmURL}_capabilities`,
        {
          method: 'POST',
          headers: {
            Accept: SupportedMimeType.JSON,
            'Content-Type': SupportedMimeType.JSON,
          },
          body: JSON.stringify({ checks }),
        },
      );
      if (!response.ok) {
        return undefined;
      }
      let body = (await response.json()) as { checks?: CapabilityAnswer[] };
      return body.checks;
    } catch {
      return undefined;
    }
  }
}
