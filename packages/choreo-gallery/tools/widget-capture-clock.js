// Capture-only clock: actual app RAF/WAAPI frames, sampled sequentially at 60 Hz.
(() => {
  const nativeRAF = window.requestAnimationFrame.bind(window);
  const nativeNow = performance.now.bind(performance);
  let active = false,
    now = 0,
    nextId = 1;
  const queued = new Map(),
    cancelled = new Set(),
    animations = new Map();
  const time = Object.getOwnPropertyDescriptor(
    Animation.prototype,
    'currentTime',
  );
  const state = Object.getOwnPropertyDescriptor(
    Animation.prototype,
    'playState',
  );
  const play = Animation.prototype.play,
    pause = Animation.prototype.pause,
    finish = Animation.prototype.finish,
    cancel = Animation.prototype.cancel;
  const track = (animation) => {
    if (animations.has(animation)) {
      return animations.get(animation);
    }
    const meta = {
      at: now,
      time: Number(time.get.call(animation) ?? 0),
      playing: state.get.call(animation) === 'running' || animation.pending,
      finished: false,
    };
    animations.set(animation, meta);
    pause.call(animation);
    return meta;
  };
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: () => (active ? now : nativeNow()),
  });
  window.requestAnimationFrame = (callback) => {
    const id = nextId++;
    if (active) {
      queued.set(id, callback);
    } else {
      nativeRAF((ts) => {
        if (cancelled.has(id)) {
          return;
        }
        if (active) {
          queued.set(id, callback);
        } else {
          callback(ts);
        }
      });
    }
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    cancelled.add(id);
    queued.delete(id);
  };
  Object.defineProperty(Animation.prototype, 'currentTime', {
    configurable: true,
    get() {
      return time.get.call(this);
    },
    set(value) {
      time.set.call(this, value);
      if (active) {
        const meta = track(this);
        meta.time = Number(value ?? 0);
        meta.at = now;
      }
    },
  });
  Object.defineProperty(Animation.prototype, 'playState', {
    configurable: true,
    get() {
      const meta = active && animations.get(this);
      return meta
        ? meta.finished
          ? 'finished'
          : meta.playing
            ? 'running'
            : 'paused'
        : state.get.call(this);
    },
  });
  Animation.prototype.play = function () {
    if (!active) {
      return play.call(this);
    }
    play.call(this);
    const meta = track(this);
    if (meta.finished) {
      meta.time = 0;
    }
    meta.finished = false;
    meta.playing = true;
    meta.at = now;
    pause.call(this);
  };
  Animation.prototype.pause = function () {
    if (!active) {
      return pause.call(this);
    }
    const meta = track(this);
    meta.playing = false;
    meta.at = now;
    pause.call(this);
  };
  Animation.prototype.cancel = function () {
    animations.delete(this);
    return cancel.call(this);
  };
  Animation.prototype.finish = function () {
    const meta = animations.get(this);
    if (meta) {
      meta.finished = true;
      meta.playing = false;
    }
    return finish.call(this);
  };
  const elementAnimate = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const animation = elementAnimate.apply(this, args);
    if (active) {
      track(animation);
    }
    return animation;
  };
  const OriginalAudio = window.Audio;
  window.Audio = class extends OriginalAudio {
    _capturePlaying = false;
    _captureAt = 0;
    _captureTime = 0;
    get currentTime() {
      return active && this.src.includes('quick-george')
        ? this._captureTime +
            (this._capturePlaying ? (now - this._captureAt) / 1000 : 0)
        : super.currentTime;
    }
    set currentTime(value) {
      if (active && this.src.includes('quick-george')) {
        this._captureTime = value;
        this._captureAt = now;
      } else {
        super.currentTime = value;
      }
    }
    get paused() {
      return active && this.src.includes('quick-george')
        ? !this._capturePlaying
        : super.paused;
    }
    play() {
      if (!active || !this.src.includes('quick-george')) {
        return super.play();
      }
      this._captureAt = now;
      this._capturePlaying = true;
      window.__captureAudio = this;
      return Promise.resolve();
    }
    pause() {
      if (!active || !this.src.includes('quick-george')) {
        return super.pause();
      }
      this._captureTime = this.currentTime;
      this._capturePlaying = false;
    }
  };
  window.__captureBegin = () => {
    now = nativeNow();
    active = true;
    for (const animation of document.getAnimations()) {
      track(animation);
    }
    return now;
  };
  window.__captureStep = async (timestamp) => {
    now = timestamp;
    for (const animation of document.getAnimations()) {
      track(animation);
    }
    for (const [animation, meta] of animations) {
      if (meta.playing && !meta.finished) {
        meta.time += (now - meta.at) * animation.playbackRate;
        meta.at = now;
        const duration = Number(animation.effect?.getComputedTiming().endTime);
        if (Number.isFinite(duration) && meta.time >= duration) {
          time.set.call(animation, duration);
          meta.playing = false;
          meta.finished = true;
          try {
            finish.call(animation);
          } catch {
            /* Capture probes may outlive a canceled animation. */
          }
        } else {
          time.set.call(animation, meta.time);
        }
      }
    }
    const callbacks = [...queued];
    queued.clear();
    for (const [id, callback] of callbacks) {
      if (!cancelled.has(id)) {
        callback(now);
      }
    }
    await Promise.resolve();
    await Promise.resolve();
  };
})();
