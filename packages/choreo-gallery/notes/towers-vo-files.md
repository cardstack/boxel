# TOWERS — narration files

The recordings the film loads, what they measure, and what is on disk that it
does not load. Voice: **Calvin — Asian, Calm, British, Professional**
(ElevenLabs `p9KVucfSoJI7y6G681mZ`, `eleven_multilingual_v2`).

- **In app:** `/asset/towers/vo/<id>.mp3`
- **On disk:** `test-app/public/asset/towers/vo/<id>.mp3`

The lines are in `notes/towers-vo.md`, the timings in the beats themselves, and
the pronunciations in `notes/towers-vo-pronunciation.md`. This file is about
the audio as audio.

## Level

Every file the film loads is normalised to **-29 dB mean** (ffmpeg
`volumedetect`). That was the level `VO_GAIN` had been trimming the loud reads
down to in code, so the mix is unchanged — but the four that were stuck
below it (`detail`, `shachi`, `timber`, `ishigaki`) are now at it rather than
under it, which is what the trim could never do: an element's volume cannot go
above 1. `VO_GAIN` is consequently empty.

The spread across the whole film is now **0.1 dB**. No peak is above -5.7
dBFS, so there is no clipping and no limiter anywhere in the chain.

## Shape of a file

0.15s of silence at the head, 0.4s at the tail, mono, 44.1 kHz, 192 kbps.
**The tail is padding, not content** — the number that matters against a beat
is where the speech ends, not how long the file is. `muneage` is the case that
makes this concrete: 4.02s in a 4s beat, and nothing is clipped, because the
speech is done at 3.58s.

## Files the film loads

| #   | Beat       | Read   | Mean     | Peak     |
| --- | ---------- | ------ | -------- | -------- |
| 01  | `title`    | 6.03s  | -29.2 dB | -5.7 dB  |
| 02  | `shiro`    | 8.18s  | -29.3 dB | -8.4 dB  |
| 03  | `what`     | 5.80s  | -29.2 dB | -8.9 dB  |
| 04  | `azuchi`   | 8.44s  | -29.3 dB | -10.3 dB |
| 05  | `teppo`    | 7.29s  | -29.3 dB | -9.1 dB  |
| 06  | `ikkoku`   | 8.20s  | -29.3 dB | -8.8 dB  |
| 07  | `ishigaki` | 11.55s | -29.3 dB | -7.5 dB  |
| 08  | `timber`   | 12.80s | -29.3 dB | -8.5 dB  |
| 09  | `plaster`  | 5.85s  | -29.2 dB | -8.6 dB  |
| 10  | `boro`     | 7.00s  | -29.3 dB | -8.4 dB  |
| 11  | `kawara`   | 9.27s  | -29.2 dB | -8.7 dB  |
| 12  | `muneage`  | 4.02s  | -29.3 dB | -12.0 dB |
| 13  | `detail`   | 3.58s  | -29.2 dB | -10.8 dB |
| 14  | `shachi`   | 10.63s | -29.3 dB | -7.0 dB  |
| 15  | `hafu`     | 10.21s | -29.3 dB | -8.3 dB  |
| 16  | `koran`    | 5.85s  | -29.3 dB | -8.6 dB  |
| 17  | `ishi2`    | 7.11s  | -29.2 dB | -7.6 dB  |
| 18  | `noki`     | 8.36s  | -29.3 dB | -9.7 dB  |
| 19  | `hikaku`   | 6.50s  | -29.3 dB | -10.3 dB |
| 20  | `c-jp`     | 4.31s  | -29.3 dB | -10.7 dB |
| 21  | `c-cn`     | 7.76s  | -29.2 dB | -9.2 dB  |
| 22  | `c-vn`     | 7.84s  | -29.2 dB | -9.6 dB  |
| 23  | `c-th`     | 6.11s  | -29.3 dB | -9.4 dB  |
| 24  | `c-kh`     | 8.59s  | -29.2 dB | -8.1 dB  |
| 25  | `c-tr`     | 7.47s  | -29.3 dB | -9.3 dB  |
| 26  | `kaitai`   | 16.12s | -29.3 dB | -8.0 dB  |

**26 files, 204.9s of speech.** Every duration here is also in
`VO_SECS` in `test-app/app/lib/films/towers.ts`, which paces the on-screen lines against the
voice rather than against the beat — a re-record means re-measuring, and the
two must agree.

## On disk, not loaded

- `coda.mp3` — the old ending's line. `kaitai` replaces it.
- `muneage-short.mp3` — the ridge-raising without "for the day".
- `*-plain.mp3` (10 files) — the reads without the Japanese term named at the
  head. The film uses the named versions; these are the alternative take if a
  beat is ever wanted without its term spoken.

All of them are finished reads, kept because re-recording one costs a
generation and none of them costs anything to keep. Nothing here is
referenced from code.

## Completed recording decisions

The ending, `kaitai`, uses the shorter approved read (16.12 seconds in a
20-second window). Two connectives were removed from the original request so
the narrator could retain the film's unhurried delivery. Its final line remains
“Enough to see from the fields.” The current script is in [towers-vo.md](towers-vo.md).

`muneage` is voiced: “Muneage. The ridge goes on, and the carpenters stop for the
day.” Its 4.02-second file fits the four-second beat because speech ends at
3.58 seconds; the remaining tail is padding. The shorter alternative remains
on disk. The older request queue's claim that this beat was silent is obsolete.

The quiet reads were levelled in the audio files rather than regenerated,
preserving the approved performances. The table above records that production
pass; remeasure any replacement instead of assuming these levels still apply.

## Recording another beat

Use the same narrator and model as the existing recordings. Specify the beat
ID, script, available window, target speech duration, and pronunciation before
recording. Budget about 150 words per minute for this performance. If a line
exceeds its window, revise the script or timing rather than rushing the read.

Place the approved file in `test-app/public/asset/towers/vo/`, measure its length,
and update `VO_SECS` in `test-app/app/lib/films/towers.ts`. Review both caption
pacing and speech end against the next shot. Keep alternate takes separate from
the filenames the score loads. Pronunciation guidance remains in
[towers-vo-pronunciation.md](towers-vo-pronunciation.md).
