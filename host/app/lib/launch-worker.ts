export async function launchWorker() {
  if (!navigator.serviceWorker.controller) {
    navigator.serviceWorker.register('./worker.js', {
      scope: '/',
    });
    let registration = await navigator.serviceWorker.ready;
    while (registration.active?.state !== 'activated') {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    window.location.reload();
  }
}
