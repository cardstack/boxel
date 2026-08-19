---
title: Avoid requestAnimationFrame for State Changes in Ember Components
impact: HIGH
impactDescription: Prevents flaky tests caused by untracked async timing
tags: testing, async, requestAnimationFrame, runloop, settled, flaky-tests
---

## Avoid requestAnimationFrame for State Changes in Ember Components

Do not use `requestAnimationFrame` to defer tracked property changes or DOM mutations in Ember components. Use `scheduleOnce('afterRender', ...)` from `@ember/runloop` instead.

**Why This Matters:**

`requestAnimationFrame` runs outside the Ember runloop. Ember's test helpers (`settled()`, `click()`, `waitFor()`, etc.) do not wait for rAF callbacks. This means:

- Tracked property changes inside rAF may not be reflected when test assertions run
- Tests pass locally but fail intermittently on CI under load
- The flakiness is extremely hard to reproduce and diagnose

`scheduleOnce('afterRender', ...)` participates in the Ember runloop, so `settled()` properly waits for it.

**Incorrect (causes flaky tests):**

```glimmer-js
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

export default class MyComponent extends Component {
  @tracked highlightedId = null;

  constructor(owner, args) {
    super(owner, args);
    // BAD: settled() won't wait for this
    requestAnimationFrame(() => this.activateFirstItem());
  }

  activateFirstItem() {
    this.highlightedId = 'first-item';
  }
}
```

**Correct (test-friendly):**

```glimmer-js
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { scheduleOnce } from '@ember/runloop';

export default class MyComponent extends Component {
  @tracked highlightedId = null;

  constructor(owner, args) {
    super(owner, args);
    // GOOD: settled() waits for afterRender queue
    scheduleOnce('afterRender', this, this.activateFirstItem);
  }

  activateFirstItem() {
    this.highlightedId = 'first-item';
  }
}
```

**When requestAnimationFrame IS appropriate:**

- Canvas/WebGL render loops (`requestAnimationFrame(this.animate)`)
- Throttling visual updates (color pickers, drag handlers)
- Measuring layout after browser paint (reading `getBoundingClientRect`)

In these cases, disable the lint rule with an inline comment:

```js
// eslint-disable-next-line @cardstack/boxel/no-raf-for-state
requestAnimationFrame(this.animate);
```

**Enforced by:** `@cardstack/boxel/no-raf-for-state` ESLint rule
