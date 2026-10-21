// A mismatch tsc explains in indented elaboration lines under the error
// line; parse must carry them in the error's message.
interface Want {
  a: { b: number };
}
const value = { a: { b: 'not a number' } };
export const got: Want = value;
