import { tracked } from '@glimmer/tracking';
/**
 * One interval for the whole page, not one per reader.
 *
 * A queue of fifty rows each holding its own `setInterval` is fifty timers,
 * fifty tracked invalidations and fifty re-renders every second — the reason
 * helpdesk queues in other tools stutter when you scroll them. Ref-counted
 * subscription means the interval only exists while something is watching, so
 * a queue scrolled off-screen costs nothing.
 *
 * It lives in `utils/` rather than beside the badge because it is no longer
 * only the badge's. The lens predicates — which decide whether a ticket counts
 * as "at risk" or "overdue" — need the same instant the badge is drawing, or
 * the rail's count and the row's badge disagree in front of the reader.
 */
class SlaClock {
  static {
    dt7948.g(this.prototype, 'now', [tracked], function () {
      return new Date();
    });
  }
  #now = (dt7948.i(this, 'now'), void 0);
  #handle = null;
  #watchers = 0;
  subscribe() {
    this.#watchers++;
    if (this.#handle == null) {
      this.#handle = setInterval(() => {
        this.now = new Date();
      }, 1000);
    }
  }
  unsubscribe() {
    this.#watchers = Math.max(0, this.#watchers - 1);
    if (this.#watchers === 0 && this.#handle != null) {
      clearInterval(this.#handle);
      this.#handle = null;
    }
  }
}
export const slaClock = new SlaClock();
