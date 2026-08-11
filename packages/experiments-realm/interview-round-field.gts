import { StringField } from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';

export const INTERVIEW_ROUNDS = [
  'phone-screen',
  'technical',
  'onsite',
  'panel',
  'final',
];

export const INTERVIEW_ROUND_LABELS: Record<string, string> = {
  'phone-screen': 'Phone screen',
  technical: 'Technical',
  onsite: 'Onsite',
  panel: 'Panel',
  final: 'Final',
};

export const INTERVIEW_ROUND_OPTIONS = INTERVIEW_ROUNDS.map((value) => ({
  value,
  label: INTERVIEW_ROUND_LABELS[value],
}));

export const InterviewRoundField = enumField(StringField, {
  options: INTERVIEW_ROUND_OPTIONS,
  displayName: 'Interview Round',
});
