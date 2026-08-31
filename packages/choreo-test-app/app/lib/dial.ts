/**
 * A spike: dialkit's store, bridged to Glimmer's tracked state.
 *
 * dialkit ships a framework-free core (`dialkit/store`, 29KB, importing
 * neither motion nor react) plus four independent UI ports. There is no Ember
 * port, and the point of this file is to find out what one would cost — see
 * docs/dialkit.md. Everything below is the bridge and nothing else; the panel
 * that draws it is `dial-panel.gts`.
 *
 * ## The whole question, in one class
 *
 * `DialStore` is an external mutable singleton with a callback subscription:
 * `subscribe(panelId, listener) => unsubscribe`. Glimmer wants tracked state.
 * The join between them is the only thing here that could go wrong, and the
 * failure mode worth naming is TEARING: a value read twice in one render
 * returning two different answers, or a store notification arriving mid-pass
 * and pulling the ground out from under a measurement Choreo already took.
 *
 * Two properties keep it honest:
 *
 * 1. **One tracked cell, not many.** `revision` is the entire tracked surface.
 *    Any store change bumps it once; everything derived reads through it. There
 *    is no second source of truth to disagree with the first.
 *
 * 2. **`@cached`, so a render sees ONE snapshot.** Without it, `values` would
 *    rebuild a fresh object on every read, and a template touching it three
 *    times would get three objects — same contents, different identities. With
 *    it, the resolve runs once per revision and every reader in that render
 *    gets the same object. That is the anti-tearing guarantee, and it is four
 *    characters long.
 *
 * ## Why this is safe inside a <Choreo> region
 *
 * A region fingerprints its score with `treePrint`, which is `JSON.stringify`
 * over the collected tree — STRUCTURAL, not identity-based. So a spring object
 * that is rebuilt but unchanged prints identically and the pass is correctly
 * declined as noise, while a spring whose numbers actually moved prints
 * differently and replays. Choreo's own comment for that branch says it: "an
 * EDITED timeline is never noise."
 *
 * Which is the good outcome twice over. Idle re-renders cost nothing, and
 * dragging a slider mid-flight replays the score against the new value — you
 * watch the spring you are editing, while you edit it.
 */
import { cached, tracked } from '@glimmer/tracking';
import type { DialConfig, DialValue, ResolvedValues } from 'dialkit/store';
import { DialStore, resolveDialValues } from 'dialkit/store';

/** what a panel accepts without caring which config produced it */
export type AnyDial = Dial<DialConfig>;

export interface DialOptions {
  /** localStorage by default; `false` to keep it in memory only */
  persist?: boolean;
  /** keep values across an unmount, so a stage remembers its tuning */
  retain?: boolean;
}

export class Dial<T extends DialConfig> {
  /**
   * The entire tracked surface of this bridge. The store is the source of
   * truth; this is the signal that it changed.
   */
  @tracked private revision = 0;

  private off: () => void;

  constructor(
    private id: string,
    name: string,
    private config: T,
    options: DialOptions = {}
  ) {
    DialStore.registerPanel(id, name, config, undefined, {
      persist: options.persist ?? true,
      retainOnUnmount: options.retain ?? true,
    });
    this.off = DialStore.subscribe(id, () => {
      this.revision += 1;
    });
  }

  /**
   * The resolved values, one snapshot per store revision.
   *
   * `@cached` is load-bearing rather than an optimisation: it is what makes
   * two reads in one render the same object. `resolveDialValues` walks the
   * config and builds a fresh tree every time it is called, so without the
   * cache a template that read `values.slide` twice would hand Choreo two
   * structurally-identical springs with different identities.
   *
   * `void this.revision` is the tracked read itself — the same idiom
   * glimmer-motion uses in node.ts (`void ownPresence?.isPresent`) to consume
   * a tracked value for its invalidation and nothing else.
   */
  @cached
  get values(): ResolvedValues<T> {
    void this.revision;
    return resolveDialValues(this.config, DialStore.getValues(this.id));
  }

  /** the flat `path -> value` map the panel walks; same revision, same object */
  @cached
  get raw(): Record<string, DialValue> {
    void this.revision;
    return DialStore.getValues(this.id);
  }

  /** what to draw: dialkit derives this from the config at registration */
  @cached
  get controls() {
    void this.revision;
    return DialStore.getPanel(this.id)?.controls ?? [];
  }

  get name() {
    return DialStore.getPanel(this.id)?.name ?? this.id;
  }

  set = (path: string, value: DialValue) => {
    DialStore.updateValue(this.id, path, value);
  };

  reset = () => {
    DialStore.resetValues(this.id);
  };

  /**
   * The instruction dialkit exists to produce: tuned numbers, in a form that
   * can be pasted at an agent to write them back into the source. The loop is
   * tune in the browser, paste, and the constants land in the file.
   */
  get instruction() {
    return `Update ${this.name} with these values:\n\n${JSON.stringify(
      this.raw,
      null,
      2
    )}`;
  }

  /**
   * Subscriptions outlive the thing that made them, so this must be called.
   * `retainOnUnmount` keeps the VALUES; it does not keep the listener, and a
   * listener still pointing at a destroyed component is how a store like this
   * leaks.
   */
  teardown() {
    this.off();
  }
}
