/** Keep the preview until the live DOM, its media and a paint opportunity exist. */
export async function tileReady(canvas: HTMLElement, signal: AbortSignal) {
  const frame = () =>
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      let id = 0;
      const done = () => {
        cancelAnimationFrame(id);
        signal.removeEventListener('abort', done);
        resolve();
      };
      signal.addEventListener('abort', done, { once: true });
      id = requestAnimationFrame(done);
    });
  while (!signal.aborted && !canvas.childElementCount) {
    await frame();
  }
  if (signal.aborted) {
    return false;
  }
  // The guided Mockup stop is ready only after its model has entered 3D.
  while (
    !signal.aborted &&
    canvas.querySelector('.mg-page') &&
    canvas.closest('.wr-shell.has-guide, .wr-shell.is-quick-tour') &&
    canvas.querySelector('.mg-page')?.getAttribute('data-mode') !== '3d'
  ) {
    await frame();
  }
  const images = [...canvas.querySelectorAll('img')];
  await Promise.race([
    Promise.allSettled([
      canvas.ownerDocument.fonts.ready,
      ...images.map((img) => img.decode()),
    ]),
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
      } else {
        signal.addEventListener('abort', () => resolve(), { once: true });
      }
    }),
  ]);
  // One frame installs the live layout; the next lets the browser paint it.
  await frame();
  await frame();
  return (
    !signal.aborted &&
    images.every((img) => img.complete && img.naturalWidth > 0)
  );
}
