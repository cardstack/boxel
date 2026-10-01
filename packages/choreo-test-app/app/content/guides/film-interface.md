# Posters, Menus, Rails, and Player Controls

A film on the web needs an interface around its picture. A poster explains what will play, a transport gives the viewer control, a chapter menu provides orientation, and an ending offers a useful next step. These pieces should read the film's handle and schedule rather than maintaining their own competing playback state.

## Opening the Experience

Film's gate block supplies front matter while the picture prepares. Its end block supplies the closing content, and the default block contains the graph and any surrounding presentation. Gate and EndCard are also exported presentation components for specialized compositions.

```gts title="Component template excerpt"
<:gate as |film|>
  <h1>A tour of Choreo</h1>
  <p>{{film.runtime}} · Interface motion, space, and film</p>
</:gate>
```

This is a named-block fragment inside Film. The host should use the ready state and begin operation for actual playback controls, including the decision to start with sound. A polished poster should not hide a permanently unready renderer behind an enabled play button.

## Showing Progress

Player supplies the floating transport, while Rail provides chapter marks on a line over the picture. `PlaybarSegment` and `RailMark` describe their data. A FilmClock can give that progress a domain meaning, such as a construction year, while the underlying score still runs in seconds.

Menu and MenuEntry provide chapter navigation; Burst supplies transient playback feedback. The contents and chapter-head helpers derive navigation from the actual edit. Avoid hard-coding chapter indices in a separate navigation array that can drift when shots are inserted.

## Preserving Input

Controls should remain usable over both bright and dark scenes and should not intercept the demo interaction they are meant to explain. Keep keyboard commands scoped so typing in a live input does not unexpectedly advance the film. On a phone, verify touch targets and safe-area placement in the actual viewport.

An embedded film may intentionally hide some shell controls, but that does not eliminate the need for an audio-start gesture or an accessible way to stop the experience. Decide which host supplies those controls before removing the built-in transport.

## Testing the Full Lifecycle

Verify loading, ready, playing, paused, ended, replaying, and error recovery. Jump between chapters while a join is active, then reopen the menu. The selected chapter, visible text, audio, and camera should agree. At the end, make sure the replay action resets both transport and commanded demo state rather than merely restarting a camera path over an already-expanded interface.

Keep debugging metadata out of the public viewing shell. Runtime build identifiers and voice configuration can remain in developer diagnostics, while the viewer sees the title, useful progress, and the controls needed to explore the work.

## API Coverage

**glimmer-motion/film**: `Burst`, `Menu`, `MenuEntry`, `PlaybarSegment`, `Player`, `Rail`, `RailMark`, `EndCard`, `Gate`.

Read the implementation: [`player.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/player.gts), [`rail.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/rail.gts), [`titles.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/titles.gts).
