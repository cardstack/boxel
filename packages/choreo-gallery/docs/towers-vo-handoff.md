# TOWERS — where the voice-over lives, for whoever picks the film up next

Written for the other sessions working on `/_towers`. The recordings are not
made in the film's branch and never have been: only a session with the
ElevenLabs MCP connected can record, MCP servers load at session start, and
so the audio arrives from the side. This is where it arrives.

## Take it from here

    branch  towers/vo-kaitai
    commit  a475a81  "Towers: the ridge-raising speaks"
    base    towers/quality @ 3774d1b

    git merge towers/vo-kaitai

It branches from `towers/quality`, so if that is where you are the merge is a
fast-forward and there is nothing to resolve.

**If it is not a fast-forward, be careful with the mp3s.** Git cannot merge
binary files: it will stop and ask, and there is no hand-editing your way out
of it. For every `test-app/public/towers/vo/*.mp3` conflict, take the version
from this branch — `git checkout --theirs <path>` — because the recordings
here are the levelled ones and anything else is the old pass.

## What is in it

**Two new recordings.** `muneage.mp3` — the ridge-raising, which was a
designed silence until Chris asked for it voiced. The beat carries a `vo`
now and its `hush` is gone, which leaves that field unused film-wide; the
mechanism stays in the source. 4.02s against a 4s beat, but the speech ends
at 3.58s and the rest is the standard tail silence, so nothing is clipped.

And `test-app/public/towers/vo/kaitai.mp3` — the ending.
16.12s in its 20s window, 0.15s of head silence and 0.4s of tail, and
`VO_SECS.kaitai` is set to match. Before this the ending was silent.

**Its line is not the line in the requests doc.** It is cut by two
connectives. The reason, the takes it was measured against, and the fallback
if you want the full line back are in `docs/towers-vo-requests.md` § 1 —
read that before assuming the file is wrong.

**Twenty-four re-levelled files.** Every read the film loads is now -29 dB
mean in the file. Nothing was re-recorded; the reads are the same takes and
the durations are unchanged to the centisecond, so `VO_SECS` did not move.

**`VO_GAIN` is empty, deliberately.** -29 dB is the level it was already
trimming the loud reads down to, so the mix is exactly where it was tuned.
What it could not do was raise the four reads sitting _below_ that level — an
element's volume cannot go above 1 — and normalising the files does. Do not
repopulate it from the old measurements; they describe files that no longer
exist. It stays in the source as the hook for a future line that lands off
the pack.

## Do not redo these

- **Re-recording `detail`, `shachi`, `timber`, `ishigaki` for level.** Done, by
  normalising rather than by a new take, which keeps reads you have already
  approved. See `docs/towers-vo-requests.md` § 3.
- **`muneage`.** Now recorded, line unchanged from the request.
  `muneage-short.mp3` beside it is the same line without "for the day", kept
  in case the full one reads as too full for a beat that is a breath.
- **`coda.mp3` and the ten `*-plain.mp3`.** Unreferenced, kept on disk on
  purpose. They are finished reads and deleting them only costs a generation
  to get back.

## Asking for the next one

Put it in `docs/towers-vo-requests.md` — line, beat id, window, target read,
direction, and any term that needs saying. That file is the queue, and a
session with the MCP will find it there. Two things make a request cheap to
fill and expensive to get wrong:

- **Give the window, and the target read inside it.** A line is recorded
  against a clock. Anything that comes in long gets flagged rather than
  rushed, which is what happened to `kaitai`.
- **Budget about 150 wpm.** That is what this narrator actually reads at,
  measured across twenty-six takes. Fifty words is twenty seconds, not
  sixteen. Writing to that number up front avoids the round trip.

The voice is **Calvin — Asian, Calm, British, Professional**, ElevenLabs
`p9KVucfSoJI7y6G681mZ`, model `eleven_multilingual_v2`. Every file in the
film is that voice; a new one must be too, or the film has two narrators.

`docs/towers-vo-files.md` is what is on disk and what it measures.
`docs/towers-vo-pronunciation.md` is how the foreign words are said.
`docs/towers-vo.md` is the script, and is generated — change the beat, not it.
