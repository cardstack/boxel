# Disallow `requestAnimationFrame` in Ember component files — use `scheduleOnce("afterRender", ...)` from `@ember/runloop` instead so that `settled()` in tests can track the work (`@cardstack/boxel/no-raf-for-state`)

<!-- end auto-generated rule header -->

`requestAnimationFrame` runs outside the Ember runloop, so `settled()` and other test helpers cannot wait for it. This causes flaky tests, especially under CI load.

Use `scheduleOnce('afterRender', ...)` from `@ember/runloop` instead. If you genuinely need a paint callback (e.g. canvas rendering, animation loops, scroll throttling), disable the rule with an inline comment.
