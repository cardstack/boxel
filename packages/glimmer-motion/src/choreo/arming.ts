/**
 * Arming — "a scene change is under way", as a value a host can read.
 *
 * A region is router-agnostic by design (§9): it discovers a crossing by
 * rendering one, and it says nothing about it to anybody. But the host around
 * it usually has to KNOW — to skip the entrance animations of cards mounting
 * mid-flight, to hold a heavy mount back until the landing, to gate anything
 * that would otherwise fire twenty springs into the middle of a move.
 *
 * Knowing turns out to be four subtleties, and two apps in a row hand-copied
 * all four before this became a library part:
 *
 *   - **The run does not exist yet.** The decision to cross is made in a route
 *     hook; the run is born after the swap renders. So the flag stands up
 *     first and the watch latches the first live run the region produces.
 *   - **A run can be REPLACED mid-flight.** A real interruption recompiles the
 *     score, and the old run's `finished` resolves as its successor takes off.
 *     Standing down there ends the crossing while it is still visibly moving,
 *     so the watch hands over to the successor instead.
 *   - **A stale settle must not stand down a newer crossing.** Generations.
 *   - **Some crossings never produce a pass at all** — aborted, or rendered
 *     identically. A deadline is the backstop, and without it the flag is a
 *     latch that never opens.
 *
 * Host-blind on purpose: no router, no owner, no framework beyond the one
 * tracked flag the templates need in order to re-render when it changes.
 */
import { tracked } from '@glimmer/tracking';

import type { Run } from './run.ts';

/** the sliver of a region a watch needs: the run it is playing right now */
export interface ArmingRegion {
  readonly run: Run | null | undefined;
}

export interface Arming {
  /** tracked: a crossing this arming is watching is under way */
  active(): boolean;
  /**
   * Arm now, and watch `region` until the run that survives has settled (or
   * the deadline passes). Called again while armed, it re-arms: the earlier
   * watch is abandoned rather than allowed to stand the new one down.
   */
  begin(region: ArmingRegion): void;
  /** stand down by hand — a test reset, or a host that knows the pass is off */
  end(): void;
  /**
   * Resolves when this arming stands down, immediately when nothing is armed.
   * What a host waits on before paying for an expensive mount.
   */
  settled(): Promise<void>;
}

export interface ArmingOptions {
  /**
   * How long to wait for a run to appear before standing down anyway, in ms
   * (default 4000). The backstop for a crossing that never produced a pass.
   */
  deadline?: number;
  /** run whenever the arming stands down — where a host clears its own flags */
  onStandDown?: () => void;
}

class Armed {
  @tracked on = false;
}

/**
 * A run that is genuinely still working. A parked run is a still and a
 * STANDING run is an annotation that is simply on (a score of nothing but
 * open steps has no end to wait for) — waiting for either to finish would
 * wait forever.
 */
const busy = (run: Run | null | undefined): run is Run =>
  Boolean(run) && !run!.isDone() && !run!.standing;

export function createArming(options: ArmingOptions = {}): Arming {
  const { deadline = 4000, onStandDown } = options;
  const state = new Armed();
  /** which crossing is current — a stale run's settle must not end a newer one */
  let generation = 0;
  const settlers: (() => void)[] = [];

  const standDown = () => {
    // guarded: writing the same value still dirties a tracked field, and a
    // host that stands an unarmed crossing down (a test reset) must not
    // invalidate everything reading the flag
    if (state.on) {
      state.on = false;
    }
    onStandDown?.();
    settlers.splice(0).forEach((resolve) => resolve());
  };

  const watch = (gen: number, region: ArmingRegion) => {
    const started = performance.now();
    const latch = (run: Run) => {
      void run.finished.then(() => {
        if (gen !== generation) {
          return;
        }
        const current = region.run;
        if (current && current !== run && busy(current)) {
          // replaced mid-flight: the crossing is still on screen, and it is
          // the successor's landing that ends it
          latch(current);
          return;
        }
        standDown();
      });
    };
    const look = () => {
      if (!state.on || gen !== generation) {
        return;
      }
      const run = region.run;
      if (busy(run)) {
        latch(run);
        return;
      }
      if (performance.now() - started > deadline) {
        standDown();
        return;
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  };

  return {
    active: () => state.on,
    begin(region) {
      state.on = true;
      watch(++generation, region);
    },
    end() {
      generation++;
      standDown();
    },
    settled() {
      if (!state.on) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => settlers.push(resolve));
    },
  };
}
