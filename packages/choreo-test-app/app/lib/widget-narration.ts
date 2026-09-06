export type NarrationResult = 'ended' | 'unavailable' | 'blocked' | 'cancelled';

export function narrationURL(source: string): string {
  const url = new URL(source, document.baseURI);
  url.searchParams.set('acceptHeader', 'audio/mpeg');
  return url.href;
}

/** One clip; recover stalled loads without letting a failed file strand the tour. */
export function playNarrationClip(
  audio: HTMLAudioElement,
  source: string,
  complete: (result: NarrationResult) => void
): (result: NarrationResult) => void {
  let closed = false;
  let attemptId = 0;
  let attempting = false;
  let reloads = 0;
  let abortRetries = 0;
  let frame = 0;
  let lastProgress = performance.now();
  let position = 0;
  let restore = 0;
  const finish = (result: NarrationResult) => {
    if (closed) {
      return;
    }
    closed = true;
    cancelAnimationFrame(frame);
    audio.removeEventListener('ended', ended);
    audio.removeEventListener('error', failed);
    audio.removeEventListener('canplay', ready);
    audio.removeEventListener('loadedmetadata', metadata);
    audio.removeEventListener('pause', interrupted);
    document.removeEventListener('visibilitychange', visible);
    if (result !== 'ended') {
      audio.pause();
    }
    complete(result);
  };
  const attempt = () => {
    if (closed || attempting) {
      return;
    }
    attempting = true;
    const token = ++attemptId;
    void audio.play().then(
      () => {
        if (closed || token !== attemptId) {
          return;
        }
        attempting = false;
      },
      (error: unknown) => {
        if (closed || token !== attemptId) {
          return;
        }
        attempting = false;
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          finish('blocked');
        } else if (
          error instanceof DOMException &&
          error.name === 'AbortError' &&
          abortRetries++ < 2
        ) {
          if (audio.readyState >= 2) {
            queueMicrotask(attempt);
          }
        } else {
          reload();
        }
      }
    );
  };
  const metadata = () => {
    if (restore > 0 && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(restore, audio.duration);
      restore = 0;
    }
  };
  const reload = () => {
    if (closed) {
      return;
    }
    if (reloads >= 2) {
      finish('unavailable');
      return;
    }
    reloads++;
    ++attemptId;
    attempting = false;
    restore = Math.max(position, audio.currentTime || 0);
    lastProgress = performance.now();
    // A cached gateway/HTML response can surface as MEDIA_ERR_SRC_NOT_SUPPORTED
    // in Safari. Request a fresh URL, not the same failed range response.
    const url = new URL(narrationURL(source));
    url.searchParams.set('audioRetry', String(reloads));
    audio.src = url.href;
    audio.load();
    attempt();
  };
  const ready = () => {
    metadata();
    if (audio.paused) {
      attempt();
    }
  };
  const ended = () => {
    if (audio.ended) {
      finish('ended');
    }
  };
  const failed = () => {
    if (audio.error) {
      reload();
    }
  };
  const interrupted = () => {
    if (!closed && !audio.ended && !document.hidden) {
      attempt();
    }
  };
  const visible = () => {
    lastProgress = performance.now();
    if (!document.hidden) {
      interrupted();
    }
  };
  const watch = () => {
    if (closed) {
      return;
    }
    const now = performance.now();
    const current = audio.currentTime;
    if (document.hidden || current !== position) {
      lastProgress = now;
      position = current;
    } else if (
      audio.ended &&
      audio.readyState >= 2 &&
      now - lastProgress > 1000
    ) {
      finish('ended');
      return;
    } else if (now - lastProgress > 8000) {
      // Covers a pending play promise or a stalled request with no error event.
      reload();
    }
    if (!closed) {
      frame = requestAnimationFrame(watch);
    }
  };
  audio.onended = null;
  audio.onerror = null;
  audio.preload = 'auto';
  audio.src = narrationURL(source);
  audio.addEventListener('ended', ended);
  audio.addEventListener('error', failed);
  audio.addEventListener('canplay', ready);
  audio.addEventListener('loadedmetadata', metadata);
  audio.addEventListener('pause', interrupted);
  document.addEventListener('visibilitychange', visible);
  attempt();
  frame = requestAnimationFrame(watch);
  return finish;
}
