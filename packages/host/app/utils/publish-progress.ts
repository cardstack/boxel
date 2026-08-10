import type { PublishProgress } from '@cardstack/runtime-common';

// Publishing runs two passes whose durations a user can't otherwise see —
// indexing every file, then rendering every page — and on a large realm they
// take minutes. Naming the pass and counting through it distinguishes slow
// progress from a hang, which an indeterminate spinner cannot. Shared by the
// publish modal and the publishing popover so both name a pass the same way.

const PHASE_LABELS: Record<PublishProgress['phase'], string> = {
  index: 'Indexing',
  render: 'Rendering',
  // Both passes have reported clear, but the publish isn't finished until the
  // readiness check confirms it — the realm-server may still be settling.
  done: 'Finishing up',
};

// The pass a publish is in. `undefined` covers the window between accepting the
// publish and its first reading, so a target is never labelled with nothing.
export function publishPhaseLabel(progress: PublishProgress | undefined) {
  return progress ? PHASE_LABELS[progress.phase] : 'Starting';
}

// The pass plus its counts, as one line. Counts are omitted until the running
// pass reports a total, which is the same point a determinate bar starts to
// mean something.
export function describePublishProgress(
  progress: PublishProgress | undefined,
): string {
  let label = publishPhaseLabel(progress);
  if (!progress || progress.totalFiles === 0) {
    return `${label}…`;
  }
  return `${label} ${progress.filesCompleted} of ${progress.totalFiles} files…`;
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
