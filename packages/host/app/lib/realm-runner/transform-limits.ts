// realm.transform's limits, in a module of their own so that the transform
// worker can read them without bundling the runner.

export const MAX_TRANSFORM_INPUT_BYTES = 1_000_000;
export const MAX_TRANSFORM_OUTPUT_BYTES = 1_000_000;
export const MAX_TRANSFORM_SOURCE_BYTES = 16 * 1024;
// One program's time, from when the worker starts to run it. A program that
// runs longer is stopped by ending its worker; the next call starts a new one.
export const TRANSFORM_TIMEOUT_MS = 10_000;
// The time the worker may take to load before it can run any program: the
// worker module and every Excel formula family.
export const TRANSFORM_WORKER_START_TIMEOUT_MS = 30_000;
// How many programs one run may run (ADR 022 §1.6).
export const MAX_TRANSFORMS_PER_RUN = 100;
