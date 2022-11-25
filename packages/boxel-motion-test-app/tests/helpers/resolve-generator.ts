import { Frame } from '@cardstack/boxel-motion/behaviors/base';

export default function resolveGenerator(generator: Generator<Frame | void>) {
  let frames: (Frame | undefined)[] = [];
  let next = generator.next();
  while (!next.done) {
    let { value, velocity } = next.value as Frame;
    let frame;
    if (next.value) {
      frame = {
        value,
        velocity,
      };
    }
    frames.push(frame);

    next = generator.next();
  }

  return frames;
}
