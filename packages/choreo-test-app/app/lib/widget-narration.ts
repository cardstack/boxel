/** One narration clip in the tour's Choreo-controlled stop sequence. */
export function playNarrationClip(
  audio: HTMLAudioElement,
  source: string,
  complete: (finished: boolean) => void
): (finished: boolean) => void {
  let closed = false;
  let attempting = false;
  let retries = 0;
  let reloads = 0;
  let waitingToRetry = false;
  const finish = (ok: boolean) => {
    if (closed) {
      return;
    }
    closed = true;
    audio.removeEventListener('ended', ended);
    audio.removeEventListener('error', failed);
    audio.removeEventListener('canplay', ready);
    audio.removeEventListener('pause', interrupted);
    document.removeEventListener('visibilitychange', visible);
    complete(ok);
  };
  const attempt = () => {
    if (closed || attempting) {
      return;
    }
    attempting = true;
    waitingToRetry = false;
    void audio.play().then(
      () => {
        attempting = false;
      },
      (error: unknown) => {
        attempting = false;
        if (closed) {
          return;
        }
        // Source changes and loading can abort a play request. A permission
        // denial needs a real user tap; repeatedly retrying cannot unlock it.
        if (
          error instanceof DOMException &&
          error.name === 'AbortError' &&
          retries++ < 2
        ) {
          waitingToRetry = true;
          if (audio.readyState >= 2) {
            queueMicrotask(attempt);
          }
        } else {
          finish(false);
        }
      }
    );
  };
  const ready = () => {
    if (waitingToRetry) {
      attempt();
    }
  };
  const ended = () => {
    if (audio.ended) {
      finish(true);
    }
  };
  const failed = () => {
    if (!audio.error) {
      return;
    } // Ignore an old source's queued event.
    if (audio.error.code === MediaError.MEDIA_ERR_NETWORK && reloads++ < 1) {
      waitingToRetry = true;
      audio.load();
    } else {
      finish(false);
    }
  };
  const interrupted = () => {
    if (!closed && !audio.ended && !document.hidden) {
      waitingToRetry = true;
      attempt();
    }
  };
  const visible = () => {
    if (!document.hidden) {
      interrupted();
    }
  };
  // Clear callbacks from the highlight player before claiming this shared element.
  audio.onended = null;
  audio.onerror = null;
  audio.preload = 'auto';
  audio.src = source;
  audio.addEventListener('ended', ended);
  audio.addEventListener('error', failed);
  audio.addEventListener('canplay', ready);
  audio.addEventListener('pause', interrupted);
  document.addEventListener('visibilitychange', visible);
  // Preserve the initial user activation: do not await camera movement or fetch.
  attempt();
  return finish;
}
