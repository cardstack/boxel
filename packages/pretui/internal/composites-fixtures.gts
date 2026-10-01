// Pretui — fixtures shared by the composites usage pages.
import type { StepItem } from '../components/step-list';

export const ORIENTATIONS = ['horizontal', 'vertical'];

export const DEPLOY_STEPS: StepItem[] = [
  { label: 'Build', state: 'complete', detail: 'Finished in 42s' },
  { label: 'Lint', state: 'in-progress', detail: 'Re-running lint\u2026' },
  {
    label: 'Sign',
    state: 'blocked',
    detail: 'Waiting on a release approval',
  },
  { label: 'Publish', state: 'upcoming', detail: '' },
];

