// Pretui — controls territory barrel. Components live under components/<name>/.
// This module re-exports the public surface so existing `from './controls'`
// importers do not change while the barrel is emptied.
export {
  PRETUI_TONES,
  emit,
  firstDefined,
  resolveSize,
  resolveTone,
} from './pretui-primitives';
export type {
  ControlAliasArgs,
  ControlNotifyArgs,
  PretuiAppearance,
  PretuiSize,
  PretuiSizeArg,
  PretuiTone,
  PretuiToneArg,
} from './pretui-primitives';

export { Button } from './components/button';
export type { ButtonSignature } from './components/button';

export { IconButton } from './components/icon-button';
export type { IconButtonSignature } from './components/icon-button';

export { Cue } from './components/cue';
export type {
  CueKind,
  CuePosition,
  CueSignature,
  CueTone,
} from './components/cue';

export { Field } from './components/field';
export type { FieldSignature } from './components/field';

export { Input } from './components/input';
export type { InputSignature } from './components/input';

export { Textarea } from './components/textarea';
export type { TextareaSignature } from './components/textarea';

export { Select } from './components/select';
export type { SelectOption, SelectSignature } from './components/select';

export { Switch } from './components/switch';
export type { SwitchSignature } from './components/switch';

export { Checkbox } from './components/checkbox';
export type { CheckboxSignature } from './components/checkbox';

export { RadioGroup } from './components/radio-group';
export type {
  RadioGroupSignature,
  RadioOption,
} from './components/radio-group';

export { SegmentedControl } from './components/segmented-control';
export type {
  SegmentOption,
  SegmentedControlSignature,
} from './components/segmented-control';

export { Tabs } from './components/tabs';
export type { TabsSignature } from './components/tabs';

export { Slider } from './components/slider';
export type { SliderSignature } from './components/slider';

export { FilterChips } from './components/filter-chips';
export type {
  FilterChipOption,
  FilterChipsSignature,
} from './components/filter-chips';

export { Rating } from './components/rating';
export type { RatingSignature } from './components/rating';
