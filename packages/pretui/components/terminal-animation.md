## What it is

A command-line session, replayed: commands typing out, output appearing, a caret blinking at the end.

The genre's appeal is the sense of something happening in order. The genre's implementation problem is that everyone reaches for a timer to get it. There is none here.

## The contract

```
@lines (required) — the session, in the order it ran
@title?       — window title. Default 'Terminal'
@startDelay?  — seconds before the first line appears. Default 0.2
@charRate?    — characters per second while a command types. Default 26
@lineDelay?   — seconds a non-command line holds the stage. Default 0.45
@typing?      — type commands out character by character. Default true
@caret?       — show the blinking caret after the last line. Default true
@replayToken? — change this to replay
@label?       — accessible name for the transcript. Default 'Terminal session'
```

**No JavaScript timing of any kind.** The schedule is computed once, as arithmetic, into two custom properties per line — when it appears, and how long its characters take. The entrance is one `animation-delay`; the typing is a width sweep whose `steps()` count is that line's own character count.

**Replay is identity, not a clock.** Every row's key includes `@replayToken`, so a new value re-creates the rows and their CSS animations start from zero. No timer, no imperative restart.

**`@charRate` and `@lineDelay` are separate on purpose.** Typing and reading are different rates because they read differently — a command appearing at reading speed looks broken, and output appearing at typing speed is unreadable.

## Prior art

The animated-terminal component in developer-marketing pages.

Where Pretui is better: the timer-free schedule, and replay by identity. Every implementation of this genre holds an index in state and advances it on an interval, which means it can desync from a re-render, leak on unmount, and cannot be replayed without an imperative handle.

Where it is thinner: no interaction — this is a replay, not a terminal — no ANSI colour parsing, no scrollback, and no pause or scrub.

## Accessibility

- **The transcript is named**, defaulting to "Terminal session".
- **The window chrome is `aria-hidden`.** The dots are decoration and announcing them would precede every session with noise.
- **The visual layer is `aria-hidden`**, which means the session's content needs to reach assistive technology as text — a reader should get the transcript, not a description of an animation.
- **Motion here is decorative in the strictest sense.** Nothing about the session's meaning depends on the order arriving over time; reduced motion should present it complete.
- **A typing animation delays legibility** for anyone watching, and `@typing={{false}}` is the honest setting for a page where the content matters more than the effect.

## Theming

`--pretui-term-bg`, `--pretui-term-size`, `--pretui-term-ch` (the character cell the width sweep measures in), `--pretui-term-at` and `--pretui-term-dur` (each line's start and duration), `--pretui-term-min`, over `--pretui-shadow-card`, `--pretui-shadow-hairline` and `--pretui-ease-enter`.

`--pretui-term-ch` is the load-bearing one: the typing sweep is a width animation, so it needs the character cell to be a known quantity, and a season that changes the mono face without checking it will produce typing that stops short of or overshoots its own text.
