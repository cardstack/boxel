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
import type {
  DialConfig,
  DialKitPersistOptions,
  DialValue,
  Preset,
  ResolvedValues,
} from 'dialkit/store';
import { DialStore, resolveDialValues } from 'dialkit/store';

/** what a panel accepts without caring which config produced it */
export type AnyDial = Dial<DialConfig>;

/**
 * A tune the stage ships, as opposed to one the store saved.
 *
 * The distinction matters to the panel: a shipped tune is always available and
 * cannot be edited in place, a saved one is the player's and can be deleted.
 * They are drawn in one row because to a person they are one question.
 */
export interface DialTune {
  name: string;
  note?: string;
  values: Record<string, DialValue>;
}

export interface DialOptions {
  /**
   * localStorage by default; `false` to keep it in memory only, or the store's
   * own options object — `{ presets: true }` is the one worth knowing about,
   * because presets are persisted SEPARATELY from values and are dropped on
   * reload without it.
   */
  persist?: DialKitPersistOptions;
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
  private bumping = false;
  private gone = false;

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
    /**
     * DEFERRED, and this is the third property the header should have named.
     *
     * A store notification can arrive at ANY time, including part-way through
     * a render — and the one that proves it is two panels sharing an id. The
     * store is a singleton keyed by panel id, so mounting a second component
     * on the same panel calls `registerPanel` during that component's
     * construction, which is inside the render pass, and the store answers by
     * notifying every existing subscriber. The FIRST component's listener then
     * runs mid-render and writes `revision` — a value that render has already
     * read. Glimmer calls that a backtracking re-render and throws.
     *
     * It is not hypothetical and it is not exotic: it is what happens when you
     * click through from a demo's gallery tile to its own page. Both are alive
     * at once for one pass, the panel is registered twice, and the tile's
     * bridge scribbles on the render in progress. The page came up with its
     * stage empty and no clue as to why, because the throw is swallowed as a
     * render error a long way from here.
     *
     * A microtask is enough. Glimmer's render is synchronous, so anything
     * queued during it runs after the pass has closed, and the bump lands as
     * an ordinary invalidation on the next revalidation instead of a write
     * into a transaction that is still open. Coalesced, because a `setAll` is
     * one intention however many paths it touches, and the store is the source
     * of truth in the meantime — nothing is lost by signalling a moment later,
     * only by signalling in the middle of a read.
     */
    this.off = DialStore.subscribe(id, () => {
      if (this.bumping || this.gone) {
        return;
      }
      this.bumping = true;
      queueMicrotask(() => {
        this.bumping = false;
        if (!this.gone) {
          this.revision += 1;
        }
      });
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

  /** a whole tune at once — one notification, so one replay rather than ten */
  setAll = (values: Record<string, DialValue>) => {
    DialStore.updateValues(this.id, values);
  };

  /* ---- presets: entirely the store's, and none of it in any UI port ---- */

  /**
   * What you saved, in the order you saved it.
   *
   * Worth knowing before building a preset row: while a preset is ACTIVE, the
   * store writes every slider edit straight into it (`updateValues`, dialkit
   * store index.js:220). That is not a bug to work around — it is the arc a
   * tuning panel wants. You load a character, you move one number, and the
   * thing you go back to is the car you ended up with rather than the one you
   * started from. Nothing has to be pressed to keep it.
   */
  @cached
  get presets(): Preset[] {
    void this.revision;
    return DialStore.getPresets(this.id);
  }

  @cached
  get activePresetId(): string | null {
    void this.revision;
    return DialStore.getActivePresetId(this.id);
  }

  savePreset = (name: string) => DialStore.savePreset(this.id, name);
  loadPreset = (presetId: string) => DialStore.loadPreset(this.id, presetId);
  deletePreset = (presetId: string) =>
    DialStore.deletePreset(this.id, presetId);

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
    // before `off`, so a bump already queued this microtask finds it and
    // declines: writing tracked state on a destroyed component is the same
    // class of mistake as writing it mid-render
    this.gone = true;
    this.off();
  }
}
