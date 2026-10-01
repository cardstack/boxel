import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { buildWaiter } from '@ember/test-waiters';

import { TrackedMap } from 'tracked-built-ins';

import {
  CAPABILITY_CHECK_CAP,
  identifyCard,
  isResolvedCodeRef,
  rri,
  SupportedMimeType,
  type CapabilityAnswer,
  type CapabilityCheck,
} from '@cardstack/runtime-common';

import type MessageService from './message-service';
import type NetworkService from './network';
import type RealmService from './realm';
import type SessionService from './session';
import type { SessionParticipant } from './session';

import type { CardDef } from '@cardstack/base/card-api';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

// ============================================================================
// `@context.canInvoke(operation, target)` — may this session invoke this
// operation on this card, or create a card of this type?
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
//
// **An answer follows its inputs.** What the realm answers depends on the
// target's stored values, the realm's policy and the caller's permissions, and
// any of them can change while a view is open. Two things keep an answer from
// outliving them. A realm's index event names the cards it changed, and every
// answer about one of them, or about any card when the realm's own config
// moved, is asked again at once. The policy card commonly lives in a realm
// this session cannot read, and a permission change broadcasts nothing a pair
// could be matched against, so neither reaches here as an event. For those, an
// answer older than `ANSWER_MAX_AGE_MS` is asked again by the next read of it,
// which is served the held answer meanwhile, so the control does not flicker.
// ============================================================================

const waiter = buildWaiter('capabilities:check');

// How long a held answer is served before the next read of it asks again. The
// same five seconds the realm's compiled-policy cache holds a policy for
// without revalidating it, and the live search cache holds a result whose
// dependency it cannot see: it is the platform's staleness bound for what the
// signals miss. Asking sooner could only return what the realm itself is still
// answering from memory.
const ANSWER_MAX_AGE_MS = 5_000;

// An answer as a template reads it. `undefined` is "not known": the value a
// pair has while the realm is being asked, after a request that could not be
// answered, and forever where there is nothing to ask (an unsaved card, a
// realm this session does not know, a render).
type Held = boolean | undefined;

// What a pair names: a stored card, by the card or its URL, or a type a card
// would be created from, by its class.
type Target = CardDef | string | typeof CardDef;

interface Asked {
  realmURL: string;
  check: CapabilityCheck;
}

export default class CapabilitiesService
  extends Service
  implements SessionParticipant
{
  @service declare private messageService: MessageService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private session: SessionService;

  // The answers, keyed by realm, operation and target together, because the
  // answer depends on all three. Tracked per key, so a pair that is answered
  // invalidates the templates that read that pair and no others. Written only
  // when an answer lands, never while a template is reading it: a read that
  // wrote here would dirty a value the same render had just consumed.
  #held: TrackedMap<string, boolean> = new TrackedMap();
  // When each held answer was given. Untracked: its age decides only whether
  // the next read asks again, never what a template shows.
  #answeredAt: Map<string, number> = new Map();
  // Every pair this session has asked about, so a realm event that changes
  // one can ask it again without a template having to read it first.
  #asked: Map<string, Asked> = new Map();
  // The pairs that have been asked about and not answered yet. Untracked for
  // the same reason as the answers, since a read is what adds to it.
  #asking: Set<string> = new Set();
  // Enrolled and not yet sent, per realm — the realm is what a request is
  // addressed to, so a view spanning two realms sends two.
  #enrolled: Map<string, Map<string, CapabilityCheck>> = new Map();
  // Whether a flush is scheduled and has not yet taken the enrolled pairs.
  // Cleared the moment it takes them, not when their requests answer, so a
  // pair enrolled while a request is in flight schedules a flush of its own.
  #scheduled = false;
  // Which session a request was asked for. A request that answers after the
  // session ended belongs to its caller, not to whoever signed in next.
  #generation = 0;
  #subscriptions: Map<string, () => void> = new Map();

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
    registerDestructor(this, () => this.#unsubscribe());
  }

  // May this session invoke `operation` on `target`?
  //
  // `target` is a saved card, its URL, or a card class. A card with no URL yet
  // is not something the realm can be asked about — there is no stored state
  // for a predicate to read — so it answers `undefined` and enrols nothing. A
  // class asks whether a card of that type may be created, or a query that
  // type declares run, in `opts.realm`, or where the call names no realm, in
  // the realm a class-scoped create lands in when it names none.
  canInvoke = (
    operation: string,
    target: Target,
    opts?: { realm?: string },
  ): Held => {
    if (!operation) {
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
    let asked = this.#pairFor(operation, target, opts);
    if (!asked) {
      return undefined;
    }
    let key = keyFor(asked);
    // Read first, so a template that reads a pair before it is answered is
    // subscribed to the answer when it lands.
    let held = this.#held.get(key);
    if (held === undefined || this.#isStale(key)) {
      this.#ask(key, asked);
    }
    return held;
  };

  // Every answer is session-scoped: who is asking is half the question, and a
  // pair says nothing about who asked it. So the session's end drops them all,
  // along with any request still in flight for it, and the next read of any
  // pair asks again as whoever signed in next.
  resetState(): void {
    this.#generation++;
    this.#held.clear();
    this.#answeredAt.clear();
    this.#asked.clear();
    this.#asking.clear();
    this.#enrolled.clear();
    this.#unsubscribe();
  }

  #pairFor(
    operation: string,
    target: Target,
    opts: { realm?: string } | undefined,
  ): Asked | undefined {
    if (typeof target === 'function') {
      let ref = identifyCard(target);
      let realmURL =
        opts?.realm ?? this.realm.defaultWritableRealm?.path ?? undefined;
      return ref && isResolvedCodeRef(ref) && realmURL
        ? { realmURL, check: { target: ref, operation } }
        : undefined;
    }
    let id = typeof target === 'string' ? target : target.id;
    if (!id) {
      return undefined;
    }
    let realmURL = this.realm.realmOf(rri(id));
    return realmURL
      ? { realmURL, check: { target: id, operation } }
      : undefined;
  }

  #isStale(key: string): boolean {
    let answeredAt = this.#answeredAt.get(key);
    return (
      answeredAt === undefined || Date.now() - answeredAt >= ANSWER_MAX_AGE_MS
    );
  }

  #ask(key: string, asked: Asked): void {
    if (this.#asking.has(key)) {
      return;
    }
    this.#asking.add(key);
    this.#asked.set(key, asked);
    let pending = this.#enrolled.get(asked.realmURL);
    if (!pending) {
      pending = new Map();
      this.#enrolled.set(asked.realmURL, pending);
    }
    pending.set(key, asked.check);
    // One flush per pass, whatever enrolled during it. Scheduled on the
    // microtask queue rather than the run loop so it runs once the pass that
    // read these pairs has finished, and held under a waiter so a test settles
    // on the answers rather than on the render that has not got them yet.
    if (!this.#scheduled) {
      this.#scheduled = true;
      let token = waiter.beginAsync();
      Promise.resolve()
        .then(() => this.#flush())
        .finally(() => waiter.endAsync(token));
    }
  }

  async #flush(): Promise<void> {
    // Taking the pairs and clearing the flag happen together, so anything
    // enrolled from here on schedules the next flush rather than waiting on a
    // request that will never carry it.
    this.#scheduled = false;
    let enrolled = [...this.#enrolled];
    this.#enrolled.clear();
    let generation = this.#generation;
    // Subscribed here rather than where a pair is read, since a read happens
    // during a render and a subscription is not something a render should be
    // registering.
    for (let [realmURL] of enrolled) {
      this.#subscribe(realmURL);
    }
    await Promise.all(
      enrolled.map(([realmURL, pending]) =>
        this.#send(realmURL, [...pending], generation),
      ),
    );
  }

  async #send(
    realmURL: string,
    pending: [string, CapabilityCheck][],
    generation: number,
  ): Promise<void> {
    for (let start = 0; start < pending.length; start += CAPABILITY_CHECK_CAP) {
      let chunk = pending.slice(start, start + CAPABILITY_CHECK_CAP);
      let answers = await this.#request(
        realmURL,
        chunk.map(([, check]) => check),
      );
      if (generation !== this.#generation) {
        // Asked for a session that has since ended. Its answers are about who
        // was signed in then, and nothing of this one's is waiting on them.
        return;
      }
      let now = Date.now();
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
          this.#answeredAt.set(key, now);
          if (this.#held.get(key) !== answer.allowed) {
            this.#held.set(key, answer.allowed);
          }
        }
      });
    }
  }

  async #request(
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

  // Listen to a realm this session has asked about, once.
  #subscribe(realmURL: string): void {
    if (this.#subscriptions.has(realmURL)) {
      return;
    }
    this.#subscriptions.set(
      realmURL,
      this.messageService.subscribe(realmURL, (event) =>
        this.#onRealmEvent(realmURL, event),
      ),
    );
  }

  #unsubscribe(): void {
    for (let unsubscribe of this.#subscriptions.values()) {
      unsubscribe();
    }
    this.#subscriptions.clear();
  }

  // Ask again about every pair an index event may have changed the answer to.
  //
  // A stored card's answer rests on its own stored values, so an event naming
  // the card asks again about it. A type's answer rests on its definition and
  // the realm's policy, which an event does not name pair by pair, so every
  // type pair in the realm is asked again on any of the realm's index events.
  // A change to the realm's own config can move the policy the realm names,
  // and an event that carries no list of what it changed can have changed
  // anything, so either asks again about the whole realm.
  //
  // The held answer stays in place until the new one lands, so a control does
  // not vanish and reappear while the realm is being asked.
  #onRealmEvent(realmURL: string, event: RealmEventContent): void {
    if (event.eventName !== 'index') {
      return;
    }
    if (event.indexType !== 'incremental' && event.indexType !== 'full') {
      return;
    }
    let invalidations =
      event.indexType === 'incremental'
        ? new Set(event.invalidations)
        : undefined;
    let configMoved =
      !invalidations ||
      invalidations.has(`${realmURL}realm`) ||
      invalidations.has(`${realmURL}realm.json`);
    for (let [key, asked] of this.#asked) {
      if (asked.realmURL !== realmURL) {
        continue;
      }
      let { target } = asked.check;
      if (
        configMoved ||
        typeof target !== 'string' ||
        invalidations!.has(target) ||
        invalidations!.has(`${target}.json`)
      ) {
        this.#ask(key, asked);
      }
    }
  }
}

function keyFor({ realmURL, check }: Asked): string {
  let { target, operation } = check;
  let named =
    typeof target === 'string'
      ? target
      : `type:${target.module}#${target.name}`;
  return `${realmURL}|${operation}|${named}`;
}
