export interface Value {}

export interface Property<V extends Value = Value> {
  read(sprite: Element): V;

  // output is just the CSS properties part of a keyframe
  write(value: V): Omit<Keyframe, 'composite' | 'easing' | 'offset'>;
}

type Duration = number | `${number}%`;

function duration(
  myDuration: Duration | undefined,
  defaultDuration: number
): number {
  if (myDuration == null) {
    return defaultDuration;
  } else if (typeof myDuration === 'string') {
    return (Number(myDuration) * defaultDuration) / 100;
  } else {
    return myDuration;
  }
}

// this is everything *except* the CSS properties part of a keyframe, which is
// instead represented by the abstract Value
export interface Frame {
  value: Value;
  offset: number;
  easing?: string;
  composite?: Keyframe['composite'];
}

export interface SpriteSets {
  kept(): KeptSpriteSet;
  removed(): RemovedSpriteSet;
  inserted(): InsertedSpriteSet;
}

export type SpriteSet = KeptSpriteSet | RemovedSpriteSet | InsertedSpriteSet;

export interface KeptSpriteSet {
  withRole(role: string): KeptSpriteSet;
  cloned(): KeptSpriteSet;
}

export interface RemovedSpriteSet {
  withRole(role: string): RemovedSpriteSet;
  cloned(): KeptSpriteSet;
}
export interface InsertedSpriteSet {
  withRole(role: string): InsertedSpriteSet;
  cloned(): KeptSpriteSet;
}

export interface PrimitiveEffect<SpriteSetType extends SpriteSet> {
  readonly sprites: SpriteSetType;
  readonly property: Property;
  readonly duration?: Duration;

  keyFrames(
    initialValue: SpriteSetType extends RemovedSpriteSet | KeptSpriteSet
      ? Value
      : undefined,
    finalValue: SpriteSetType extends InsertedSpriteSet | KeptSpriteSet
      ? Value
      : undefined
  ): Frame[];
}

export type Effect = PrimitiveEffect<SpriteSet> | ParallelEffect | SeriesEffect;

export type Transition = (sprites: SpriteSets) => Effect;

export let example: Transition = (sprites) => {
  console.log('now');
  return new EaseInEffect(sprites.kept().withRole('person'), 'height');
};

export class EaseInEffect implements PrimitiveEffect<KeptSpriteSet> {
  constructor(
    readonly sprites: KeptSpriteSet,
    readonly property: Property,
    readonly duration?: Duration
  ) {}

  keyFrames(initialValue: Value, finalValue: Value) {
    return [
      {
        offset: 0,
        value: initialValue,
        easing: 'ease-in',
      },
      {
        offset: 1,
        value: finalValue,
      },
    ];
  }
}

export class ParallelEffect {
  constructor(private children: PrimitiveEffect<SpriteSet>[]) {}

  keyFrames(defaultDurationMS: number) {
    return this.children.flatMap((child) => child.keyFrames(defaultDurationMS));
  }
}

export class SeriesEffect {
  constructor(private children: PrimitiveEffect<SpriteSet>[]) {}
  keyFrames(_defaultDurationMS: number) {
    return [];
  }
}
