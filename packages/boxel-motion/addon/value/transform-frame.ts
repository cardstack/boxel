import SimpleFrame, { Frame } from '@cardstack/boxel-motion/value/simple-frame';

export default class TransformFrame implements Frame {
  // for the first iteration we just support translation to keep things simple
  // this definition also denotes the order in which these properties are serialized
  static readonly combinesProperties = new Set(['translateX', 'translateY']);

  property = 'transform';
  frames: SimpleFrame[];

  constructor(frames: SimpleFrame[]) {
    this.frames = frames;
  }

  serializeValue(): string {
    let frames = new Map();

    this.frames.forEach((frame) => {
      if (frames.has(frame.property)) {
        frames.get(frame.property).push(frame.serializeValue());
      } else {
        frames.set(frame.property, [frame.serializeValue()]);
      }
    });

    let result: string[] = [];
    TransformFrame.combinesProperties.forEach((property) => {
      if (frames.has(property)) {
        result = result.concat(`${property}(${frames.get(property)})`);
      }
    });

    return result.join(' ');
  }
}
