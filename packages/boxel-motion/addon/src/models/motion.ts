import type Behavior from '../behaviors/base.ts';
import { type Value } from '../value/index.ts';

export type MotionProperty = string;

interface InterpolatableMotionOptions {
  behavior: Behavior;
  from: Value;
  to: Value;
  velocity?: number;
}

interface NonInterpolatableMotionOptions {
  value: Value;
}

export interface MotionTiming {
  behavior: Behavior;
  delay?: number;
  duration?: number;
  easing?: string;
}

// TODO: this seems rather awful, let's find a better solution
export type MotionOptions = Partial<
  InterpolatableMotionOptions & NonInterpolatableMotionOptions
>;
