// Copy every own property of a thrown value onto a plain object, so
// `jobs.result` can hold it as jsonb and the row still explains why the job
// failed. A job handler can throw anything, including an Error whose useful
// fields are all non-enumerable, so nothing is assumed about the shape.
//
// Deliberately not called `serializableError`: runtime-common exports a
// function by that name which does something else — it is card-error aware and
// returns anything that is not a card error untouched, leaving serialization to
// pg. Swapping one for the other silently changes what lands in the row, so
// they are named for what they do rather than for the problem they share.

export function flattenErrorForJsonb(err: any): Record<string, any> {
  try {
    let result = Object.create(null);
    for (let field of Object.getOwnPropertyNames(err)) {
      result[field] = err[field];
    }
    return result;
  } catch (megaError) {
    let stringish: string | undefined;
    try {
      stringish = String(err);
    } catch (_ignored) {
      // ignoring
    }
    return {
      failedToSerializeError: true,
      string: stringish,
    };
  }
}
