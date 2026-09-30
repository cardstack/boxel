// A one-shot rendering boundary, not an animation clock. Give native bitmap
// playback its first paint before mounting an expensive live card body.
export function afterMotionPaint(callback: () => void) {
  let frame = 0;
  let done = false;
  let finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(deadline);
    callback();
  };
  // Background tabs may suspend rAF. Content must still become available.
  let deadline = setTimeout(finish, 100);
  // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- One-shot paint boundary; Choreo exclusively drives animation frames.
  frame = requestAnimationFrame(() => {
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- Second frame guarantees a paint opportunity before expensive mounting.
    frame = requestAnimationFrame(finish);
  });
  return finish;
}
