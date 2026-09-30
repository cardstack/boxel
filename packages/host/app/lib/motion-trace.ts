// User Timing markers only exist in the opt-in performance preview. They can
// be read by the in-app recorder or a browser Performance trace.
const enabled = new URLSearchParams(location.search).has('motionTrace');

export function traceMotionPhase(phase: string) {
  if (enabled) performance.mark(`boxel-motion:${phase}`);
}
