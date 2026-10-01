/**
 * View Transitions for Glimmer.
 *
 * `animateView` is Motion's document-level API (auto names, crop, springs,
 * queued interrupts). `viewTransition` can target an element so a study
 * morphs inside its own box without snapshotting the rest of the page.
 */
import { join, schedule } from '@ember/runloop';
import {
  animateView as motionAnimateView,
  type ViewTransitionBuilder,
  type ViewTransitionOptions,
} from 'motion-dom';

export type ViewTransitionUpdate = () => void | Promise<void>;
export type {
  ViewTransitionBuilder,
  ViewTransitionOptions,
  ViewTransitionTargetDefinition,
} from 'motion-dom';

interface ViewTransitionHandle {
  finished: Promise<void>;
}

interface ViewTransitionHost {
  startViewTransition(update?: ViewTransitionUpdate): ViewTransitionHandle;
}

export function animateView(
  update: ViewTransitionUpdate,
  options?: ViewTransitionOptions,
): ViewTransitionBuilder {
  return motionAnimateView(async () => {
    await apply(update);
  }, options);
}

export async function viewTransition(
  update: ViewTransitionUpdate,
  root?: Element | null,
): Promise<void> {
  if (prefersReducedMotion()) {
    await apply(update);
    return;
  }

  const host = resolveHost(root);
  if (!host) {
    await apply(update);
    return;
  }

  try {
    await host.startViewTransition(() => apply(update)).finished;
  } catch {
    // Interrupted or skipped transitions reject `finished`.
  }
}

function resolveHost(root?: Element | null): ViewTransitionHost | null {
  if (isHost(root)) {
    return root;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  if (isHost(document.body)) {
    return document.body;
  }
  if (isHost(document)) {
    return document;
  }
  return null;
}

function isHost(value: unknown): value is ViewTransitionHost {
  return (
    !!value &&
    typeof (value as ViewTransitionHost).startViewTransition === 'function'
  );
}

async function apply(update: ViewTransitionUpdate): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line ember/no-runloop -- this is the host wait for the Glimmer commit
    join(() => {
      Promise.resolve(update()).then(resolve, reject);
    });
  });
  await afterRender();
}

function afterRender(): Promise<void> {
  return new Promise((resolve) => {
    // eslint-disable-next-line ember/no-runloop -- wait for the paint that follows the tracked write
    schedule('afterRender', null, resolve);
  });
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
