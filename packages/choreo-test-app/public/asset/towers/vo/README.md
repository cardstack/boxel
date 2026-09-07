# Narration

One audio file per beat, named for the beat's id:

    title.mp3
    shiro.mp3
    what.mp3
    ...

The full list — every beat's window, word count and line — is in
[`notes/towers-vo.md`](../../../../../notes/towers-vo.md), together with the voice direction. That file is
GENERATED from the beats in the film score and `test-app/app/lib/films/towers.ts`;
regenerate it rather than editing it, or the narration and the shot list
drift apart.

One file per beat rather than one long track, because chapter skip
re-cuts the film: a single track would have to be sought, and a sought
track against a re-cut score drifts inside a chapter.

A missing file is silence, not an error. The film plays fine with this
folder empty, which is the point — the score has to be right whether or
not the voice has been recorded yet. While a line plays, the scene's own
music ducks to 18%.

To read the words against the pictures before any audio exists, open the
film with `?subs`.
