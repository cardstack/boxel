// realm.transform's limits, in a module of their own so that the transform
// worker can read them without bundling the runner.

export const MAX_TRANSFORM_INPUT_BYTES = 1_000_000;
export const MAX_TRANSFORM_OUTPUT_BYTES = 1_000_000;
export const MAX_TRANSFORM_SOURCE_BYTES = 16 * 1024;
// One program's time, from when the worker starts it, including the Excel
// formula families it loads. BXL stops a program that runs longer.
export const TRANSFORM_TIMEOUT_MS = 10_000;
// A program BXL has not stopped this long after its time is stalled outside
// BXL's metering; the host then ends the worker, and the next call starts a
// new one.
export const TRANSFORM_STALL_GRACE_MS = 5_000;
// BXL's step limit. Set high, so that time and size are the limits a program
// meets: BXL's default would refuse a map over a few thousand objects.
export const TRANSFORM_MAX_STEPS = 50_000_000;
// The time the worker module may take to load before it can run any program.
export const TRANSFORM_WORKER_START_TIMEOUT_MS = 30_000;
// How many programs one run may run, and how many bytes they may move in and
// out together (ADR 022 §1.6).
export const MAX_TRANSFORMS_PER_RUN = 100;
export const MAX_TRANSFORM_BYTES_PER_RUN = 10_000_000;
