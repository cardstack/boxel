# Towers — voice-over requests

Lines to record. Same voice, same read as the rest of the film (see
`docs/towers-vo.md` › Voice): Calvin, `eleven_multilingual_v2`. Dry,
unhurried, certain. Short declaratives, full stops, no lift at the end
of a line, no smile in the read. The camera is always moving; the voice
sounds like somebody standing still.

## Delivery

- One file per beat: `test-app/public/towers/vo/<id>.mp3`, mono, 44.1 or
  48 kHz, 128 kbps or better.
- Level: the film trims each line to sit near −29 dB mean (ffmpeg
  `volumedetect`); record at a consistent level and leave headroom — no
  peak above −3 dBFS, no limiter. If a line lands far from the others,
  add it to `VO_GAIN` in `tower-film.gts`.
- Then set `VO_SECS[<id>]` in `tower-film.gts` to the file's duration in
  seconds (ffprobe): the on-screen lines are paced against it.
- Silence: about 0.15 s at the head, 0.4 s at the tail. The film rises
  the line in over 70 ms and fades it out itself.

## 1. `kaitai` — the ending (NEW, needed)

**Window:** 20 s, under the takedown and the day running out. **Target
read:** 15–17 s. The end card arrives on the last stone; the line must
be finished by then.

**Line:**

> Take it down in the order it went up. Tile, plaster, timber. Stone
> last — the stone was never the building. It was the ground, raised.
> What is left is a hill with a shape in it. And the shape is enough to
> see from the fields.

**Direction:** this is the last thing said. Slower than the rest by a
hair, not softer. "Stone last" is two words with a full stop after it.
The dash before "the stone was never the building" is a breath, not a
pause for effect. The final sentence is the film's own last line from
the old coda ("a roof built tall enough to be seen from the fields")
turned round; land it flat, no swell.

**Pronunciation:** no terms named in this line. The kanji on screen is
解体 (kaitai, "dismantling") — not spoken.

**On-screen cues** (paced by `VO_SECS`): "Tile, plaster, timber" ·
"Stone last" · "A hill with a shape in it" · "Enough to see from the
fields".

## 2. `muneage` — the ridge-raising (optional)

Currently a designed silence (`hush`) at 1:56, four seconds, the frame
clear of type. If a line is wanted:

> Muneage. The ridge goes on, and the carpenters stop for the day.

**Target read:** under 3.5 s. Say "muneage" as mu-ne-a-ge (four even
syllables, hard g). Only record if the silence is not working; the
silence is the intended cut.

## 3. Re-records worth doing (optional)

Measured against the rest (mean loudness), these sit furthest from the
pack and are being trimmed in code:

| file         | mean dB | note                                                |
| ------------ | ------- | --------------------------------------------------- |
| `detail.mp3` | −31.9   | quietest line in the film; the trim cannot raise it |
| `shachi.mp3` | −30.3   | quiet                                               |
| `timber.mp3` | −30.2   | quiet, and the tightest fit (12.8 s in a 14 s beat) |
| `hikaku.mp3` | −24.6   | loudest; trimmed to 0.60                            |

A re-record of the three quiet ones at the level of the others would let
the trim table shrink toward 1.0. Same lines, same direction; see
`docs/towers-vo.md` for the text and the term pronunciations.

## Not needed

- `unbuild` and `coda` no longer exist as beats; `coda.mp3` on disk is
  unreferenced (the ending replaces it).
- The `-plain` variants on disk are unreferenced.
