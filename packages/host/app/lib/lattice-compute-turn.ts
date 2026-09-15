import type { ComputePassSnapshot } from '@cardstack/base/card-api';

type ComputeAPI = {
  beginComputePass?: () => void;
  endComputePass?: () => ComputePassSnapshot;
};

// Only the initiating JavaScript turn shares computed values. In particular,
// a returned Promise does not extend the memo into its asynchronous work.
// Each load-settling pass must start a new turn after its inputs arrive.
// Called outside any existing compute pass, like the serialization boundary.
export function captureLatticeComputeTurn<T>(
  api: ComputeAPI,
  run: () => T,
): { value: T; metrics?: ComputePassSnapshot } {
  if (!api.beginComputePass || !api.endComputePass) {
    return { value: run() };
  }
  api.beginComputePass();
  let value: T;
  let metrics: ComputePassSnapshot;
  try {
    value = run();
  } finally {
    metrics = api.endComputePass();
  }
  return { value, metrics };
}
