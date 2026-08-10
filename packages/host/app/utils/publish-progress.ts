import type { PublishProgress } from '@cardstack/runtime-common';

// Publishing runs two passes whose durations a user can't otherwise see —
// indexing every file, then rendering every page — and on a large realm they
// take minutes. Naming the pass and counting through it distinguishes slow
// progress from a hang, which an indeterminate spinner cannot. Shared by the
// publish modal and the publishing popover so both describe a pass the same
// way.

const PHASE_LABELS: Record<PublishProgress['phase'], string> = {
  // Enqueued with no worker on it. Named rather than folded into "Indexing" so
  // a backed-up or stalled queue doesn't look like a slow index.
  queued: 'Waiting for a worker',
  index: 'Indexing',
  render: 'Rendering',
  // Both passes have reported clear, but the publish isn't finished until the
  // readiness check confirms it — the realm-server may still be settling.
  done: 'Finishing up',
};

export interface PublishProgressView {
  // The pass on its own, e.g. "Indexing".
  phaseLabel: string;
  // The pass plus its counts as one line, e.g. "Indexing 42 of 270 files…".
  description: string;
  // Set only once the running pass reports a total, which is the point a
  // determinate bar starts to mean something. Absent between accepting the
  // publish and its first reading, and between the two passes.
  counts?: { completed: number; total: number };
}

export function publishProgressView(
  progress: PublishProgress | undefined,
): PublishProgressView {
  // No reading yet: the publish has been accepted but its first pass hasn't
  // reported. Still labelled, so a target never renders as a bare URL.
  if (!progress) {
    return { phaseLabel: 'Starting', description: 'Starting…' };
  }
  let phaseLabel = PHASE_LABELS[progress.phase];
  if (progress.totalFiles === 0) {
    return { phaseLabel, description: `${phaseLabel}…` };
  }
  return {
    phaseLabel,
    description: `${phaseLabel} ${progress.filesCompleted} of ${progress.totalFiles} files…`,
    counts: {
      completed: progress.filesCompleted,
      total: progress.totalFiles,
    },
  };
}

// The host of a publish target, for labelling one target's progress among
// several. Falls back to the whole URL rather than dropping the label when the
// value isn't parseable.
export function publishTargetHost(publishedRealmURL: string): string {
  try {
    return new URL(publishedRealmURL).host;
  } catch {
    return publishedRealmURL;
  }
}
