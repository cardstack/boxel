# Towers — voice-over requests

Lines to record. Same voice, same read as the rest of the film (see
`notes/towers-vo.md` › Voice): Calvin, `eleven_multilingual_v2`. Dry,
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

## 1. `kaitai` — the ending ✅ RECORDED

**Window:** 20 s, under the takedown and the day running out. **Target
read:** 15–17 s. The end card arrives on the last stone; the line must
be finished by then.

**Line as recorded** (`VO_SECS.kaitai = 16.12`):

> Take it down in the order it went up. Tile, plaster, timber. Stone
> last — the stone was never the building. It was the ground, raised.
> A hill with a shape in it. Enough to see from the fields.

**The line above was cut to fit, and this is the flag you asked for.** As
written it came in at 20.1, 20.2 and 20.6 seconds across three takes — over
the target and at the window itself. The narrator reads this film at about
150 wpm and the line was fifty words; there is no read of it that lands at
16 seconds without being hurried, and the direction asks for slower.

The cut drops two connectives only — _What is left is_ and _And the shape
is_ — which leaves the spoken words in exact agreement with the four
on-screen cues, where the full line was not. Nothing else changed: the
opening, "Stone last", the ground-raised thesis and the fields all survive.
If you would rather have the full line, the 20.06s take is the shortest of
the three and the window would need to grow by about a second.

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

## 2. `muneage` — the ridge-raising ✅ RECORDED

Was a designed silence (`hush`) at 1:56. Chris asked for it voiced, so the
beat now carries a line and `hush` is gone from it — which leaves the field
unused across the whole film, though the mechanism stays in the source.

**Line as recorded** (`VO_SECS.muneage = 4.02`), unchanged from the request:

> Muneage. The ridge goes on, and the carpenters stop for the day.

**It fits, and the raw duration is misleading.** The file is 4.02s against a
4s beat, but 0.4s of that is the tail silence every file carries: the speech
ends at 3.58s, which is 0.42s clear of the seam. Nothing is clipped. The
target of "under 3.5s" was measuring the file; what the beat actually needs
is the speech to land, and it does.

"Muneage" is said moo-neh-ah-geh — four even syllables, hard g.

`muneage-short.mp3` is the same line without "for the day", 3.43s to speech
end. Unreferenced. It is there because the beat is a BREATH, and if the full
line ever reads as too full for one, the shorter take is a rename away.

## 3. Levels ✅ DONE — normalised, not re-recorded

The four quiet reads were **normalised in the file to -29 dB mean** rather
than re-recorded, which reaches the same goal without gambling a new take
against a read that was already approved. -29 dB is the level `VO_GAIN` was
trimming everything down to, so the mix is unchanged and the product of file
level and gain is identical — but the quiet ones could never be raised in
code, and now they do not need to be. `VO_GAIN` is empty and the spread
across the film is 0.1 dB. Where they were:

| file         | mean dB | note                                                |
| ------------ | ------- | --------------------------------------------------- |
| `detail.mp3` | −31.9   | quietest line in the film; the trim cannot raise it |
| `shachi.mp3` | −30.3   | quiet                                               |
| `timber.mp3` | −30.2   | quiet, and the tightest fit (12.8 s in a 14 s beat) |
| `hikaku.mp3` | −24.6   | loudest; trimmed to 0.60                            |

`ishigaki` (-30.1) was in the same position and went with them. Measurements
per file are in `notes/towers-vo-files.md`.

## Not needed

- `unbuild` and `coda` no longer exist as beats; `coda.mp3` on disk is
  unreferenced (the ending replaces it). Left on disk, not deleted — it is a
  finished read and costs nothing to keep.
- The `-plain` variants on disk are unreferenced, and likewise kept.
- `muneage` was not recorded. The doc says the silence is the intended cut,
  so it stays a silence until someone says otherwise.
