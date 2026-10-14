import { tracked } from '@glimmer/tracking';
import type { DialConfig, DialValue } from 'dialkit/vanilla';
import { DialStore } from 'dialkit/vanilla';
import { postRender, retime } from 'glimmer-motion';

import { Dial, type DialTune } from './dial';
import { demoPresets } from './presets';
import { demoTuning } from './tuning';

/**
 * The key a demo's lab tunes it under: its slug. A demo without one has no
 * lab, and neither do the films, which play in documents of their own the
 * lab can't reach.
 */
export function labSlug(demo: {
  slug?: string | null;
  theater?: boolean | null;
}): string | undefined {
  return demo.theater !== true && demo.slug ? demo.slug : undefined;
}

/**
 * What a view showing a demo keeps for its lab: which demo the lab is open
 * on, and how many times its stage has been replayed. The lab belongs to the
 * demo it was opened on, so a view that moves to another demo shows it
 * closed.
 */
export class LabState {
  @tracked private openOn: string | null = null;
  /** counts replays: each one mounts the stage afresh */
  @tracked replays = 0;

  isOpen(slug: string | undefined): boolean {
    return slug !== undefined && this.openOn === slug;
  }

  toggle = (slug: string | undefined) => {
    this.openOn = this.isOpen(slug) ? null : (slug ?? null);
  };

  replay = () => {
    this.replays++;
  };
}

/** how many labs are open on each demo, by its slug */
const openLabs = new Map<string, number>();

/**
 * Retime the motion running on every stage showing a demo, once the render
 * that delivers the demo's new values has landed. An edit reaches the stage
 * as it renders, but motion already running reads its timing when it starts:
 * this restarts what the edit retimed, keeping each loop's place in its
 * cycle. A Choreo timeline needs nothing here, because an edited timeline
 * replaces its run, and the new run carries its loops on.
 */
function retimeStages(slug: string) {
  postRender(() => {
    for (let stage of document.querySelectorAll(
      `[data-demo-tuning="${CSS.escape(slug)}"]`,
    )) {
      retime(stage);
    }
  });
}

/**
 * A demo's tuning on a dialkit panel: the lab.
 *
 * The panel's controls are the values the demo registers through
 * `demoTuning(slug)` as it renders, so the panel grows as the stage does. An
 * edit on the panel is written back into `demoTuning(slug).values`, where the
 * demo reads it. Only the values that differ from the demo's own are written,
 * so an untouched spring comes back from `tuneMotion` as the same object and
 * never replays a scene.
 *
 * An edit retimes motion the stage already has running, so a loop changes
 * speed where it is rather than on the next replay.
 *
 * Every lab open on one demo drives the same panel, so they show the same
 * values. The panel is neither persisted nor retained: closing the demo's
 * last lab puts the demo back as it was written.
 */
export class DemoLab {
  readonly dial: Dial<DialConfig>;
  /** bumped as the demo registers controls, which the presets depend on */
  @tracked private registered = 0;

  private slug: string;
  private stop: () => void;
  private writing = false;
  private gone = false;

  constructor(slug: string, name: string) {
    this.slug = slug;
    openLabs.set(slug, (openLabs.get(slug) ?? 0) + 1);
    this.dial = new Dial(`lab:${slug}`, name, this.config(), {
      persist: false,
      retain: false,
    });
    this.state.listeners.add(this.refresh);
    this.stop = DialStore.subscribe(this.dial.panelId, this.write);
    this.write();
  }

  private get state() {
    return demoTuning(this.slug);
  }

  private config(): DialConfig {
    return { ...this.state.definitions };
  }

  /**
   * The demo's authored looks whose every control the demo has registered;
   * the panel offers them as its shipped tunes.
   */
  get presets(): DialTune[] {
    void this.registered;
    let definitions = this.state.definitions;
    return (demoPresets[this.slug] ?? []).filter((preset) =>
      Object.keys(preset.values).every((key) => key in definitions),
    );
  }

  private refresh = () => {
    if (this.gone) {
      return;
    }
    this.dial.configure(this.config());
    this.registered += 1;
  };

  /**
   * A store notification can arrive inside a render pass (a panel registering
   * notifies its subscribers), and the values it writes are tracked state the
   * stage has already read in that pass, so the write waits for the pass to
   * close.
   */
  private write = () => {
    if (this.writing || this.gone) {
      return;
    }
    this.writing = true;
    queueMicrotask(() => {
      this.writing = false;
      if (this.gone) {
        return;
      }
      let changed = changedValues(
        this.state.definitions,
        DialStore.getValues(this.dial.panelId),
      );
      if (JSON.stringify(this.state.values) !== JSON.stringify(changed)) {
        this.state.values = changed;
        retimeStages(this.slug);
      }
    });
  };

  teardown() {
    this.gone = true;
    this.state.listeners.delete(this.refresh);
    this.stop();
    this.dial.teardown();
    DialStore.unregisterPanel(this.dial.panelId);
    let open = (openLabs.get(this.slug) ?? 1) - 1;
    if (open > 0) {
      openLabs.set(this.slug, open);
    } else {
      openLabs.delete(this.slug);
      if (Object.keys(this.state.values).length) {
        this.state.values = {};
        retimeStages(this.slug);
      }
    }
  }
}

/**
 * The panel's values that differ from the demo's own, by control. A control's
 * own value is its definition, or the first entry of a `[value, min, max,
 * step]` range. An object value differs when any field on either side does,
 * so a field the editor adds (a spring's `mass` beside an authored stiffness
 * and damping) counts as an edit.
 */
export function changedValues(
  definitions: DialConfig,
  values: Record<string, DialValue>,
): Record<string, DialValue> {
  let changed: Record<string, DialValue> = {};
  for (let [key, value] of Object.entries(values)) {
    let definition = definitions[key];
    if (definition === undefined) {
      continue;
    }
    let own = Array.isArray(definition) ? definition[0] : definition;
    let same =
      own && typeof own === 'object' && value && typeof value === 'object'
        ? sameFields(
            own as Record<string, unknown>,
            value as Record<string, unknown>,
          )
        : own === value;
    if (!same) {
      changed[key] = value;
    }
  }
  return changed;
}

function sameFields(a: Record<string, unknown>, b: Record<string, unknown>) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(
    (field) => JSON.stringify(a[field]) === JSON.stringify(b[field]),
  );
}
