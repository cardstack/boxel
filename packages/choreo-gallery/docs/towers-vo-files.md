# TOWERS — narration files

25 mp3s, one per beat, recorded in the voice **Calvin — Asian, Calm, British,
Professional** (ElevenLabs `p9KVucfSoJI7y6G681mZ`, model `eleven_multilingual_v2`).
Lines come from `docs/towers-vo.md`; pronunciation from `docs/towers-vo-pronunciation.md`.

They are on disk already, committed on `claude/japanese-garden-narration-4939aa`.
`test-app/public/` is served from the app root, so the path the film loads is
`/towers/vo/<id>.mp3` — no import, no build step, just fetch it.

- **In app (any env):** `/towers/vo/<id>.mp3`
- **Dev server:** `http://localhost:4200/towers/vo/<id>.mp3`
- **On disk:** `test-app/public/towers/vo/<id>.mp3`

**Headroom** is window minus recorded length: the silence the beat has left over
once the line is read. The handoff asks for a start about 0.4s in and a finish
about 0.6s before the cut, so anything at 1.0s or over is comfortable.

| #   | Beat       | Chapter         | Window          | In-app URL                | Read   | Headroom  |
| --- | ---------- | --------------- | --------------- | ------------------------- | ------ | --------- |
| 01  | `title`    | 01 CONTEXT      | 0:00–0:10 · 10s | `/towers/vo/title.mp3`    | 5.04s  | +4.96s    |
| 02  | `shiro`    | 01 CONTEXT      | 0:10–0:20 · 10s | `/towers/vo/shiro.mp3`    | 8.18s  | +1.82s    |
| 03  | `what`     | 01 CONTEXT      | 0:20–0:28 · 8s  | `/towers/vo/what.mp3`     | 5.80s  | +2.20s    |
| 04  | `azuchi`   | 02 HISTORY      | 0:28–0:38 · 10s | `/towers/vo/azuchi.mp3`   | 8.44s  | +1.56s    |
| 05  | `teppo`    | 02 HISTORY      | 0:38–0:48 · 10s | `/towers/vo/teppo.mp3`    | 7.29s  | +2.71s    |
| 06  | `ikkoku`   | 02 HISTORY      | 0:48–0:56 · 8s  | `/towers/vo/ikkoku.mp3`   | 8.20s  | -0.20s ⚠️ |
| 07  | `ishigaki` | 03 CONSTRUCTION | 0:56–1:06 · 10s | `/towers/vo/ishigaki.mp3` | 8.18s  | +1.82s    |
| 08  | `timber`   | 03 CONSTRUCTION | 1:06–1:18 · 12s | `/towers/vo/timber.mp3`   | 10.16s | +1.84s    |
| 09  | `plaster`  | 03 CONSTRUCTION | 1:18–1:26 · 8s  | `/towers/vo/plaster.mp3`  | 6.35s  | +1.65s    |
| 10  | `boro`     | 03 CONSTRUCTION | 1:26–1:36 · 10s | `/towers/vo/boro.mp3`     | 5.88s  | +4.12s    |
| 11  | `kawara`   | 03 CONSTRUCTION | 1:36–1:48 · 12s | `/towers/vo/kawara.mp3`   | 9.64s  | +2.36s    |
| 12  | `detail`   | 04 DETAIL       | 1:48–1:54 · 6s  | `/towers/vo/detail.mp3`   | 3.58s  | +2.42s    |
| 13  | `shachi`   | 04 DETAIL       | 1:54–2:04 · 10s | `/towers/vo/shachi.mp3`   | 7.37s  | +2.63s    |
| 14  | `hafu`     | 04 DETAIL       | 2:04–2:14 · 10s | `/towers/vo/hafu.mp3`     | 8.86s  | +1.14s    |
| 15  | `koran`    | 04 DETAIL       | 2:14–2:22 · 8s  | `/towers/vo/koran.mp3`    | 4.86s  | +3.14s    |
| 16  | `ishi2`    | 04 DETAIL       | 2:22–2:32 · 10s | `/towers/vo/ishi2.mp3`    | 7.11s  | +2.89s    |
| 17  | `noki`     | 04 DETAIL       | 2:32–2:44 · 12s | `/towers/vo/noki.mp3`     | 10.21s | +1.79s    |
| 18  | `hikaku`   | 05 COMPARISON   | 2:44–2:52 · 8s  | `/towers/vo/hikaku.mp3`   | 6.50s  | +1.50s    |
| 19  | `c-jp`     | 05 COMPARISON   | 2:52–3:00 · 8s  | `/towers/vo/c-jp.mp3`     | 4.31s  | +3.69s    |
| 20  | `c-cn`     | 05 COMPARISON   | 3:00–3:10 · 10s | `/towers/vo/c-cn.mp3`     | 7.76s  | +2.24s    |
| 21  | `c-vn`     | 05 COMPARISON   | 3:10–3:20 · 10s | `/towers/vo/c-vn.mp3`     | 7.84s  | +2.16s    |
| 22  | `c-th`     | 05 COMPARISON   | 3:20–3:28 · 8s  | `/towers/vo/c-th.mp3`     | 6.11s  | +1.89s    |
| 23  | `c-kh`     | 05 COMPARISON   | 3:28–3:38 · 10s | `/towers/vo/c-kh.mp3`     | 8.59s  | +1.41s    |
| 24  | `c-tr`     | 05 COMPARISON   | 3:38–3:48 · 10s | `/towers/vo/c-tr.mp3`     | 7.47s  | +2.53s    |
| 25  | `coda`     | CODA            | 3:48–4:00 · 12s | `/towers/vo/coda.mp3`     | 11.36s | +0.64s ⚠️ |

**Recorded total 185.1s of speech across a 4:00 film** — the rest is air, which is
what a film like this wants: the voice is not meant to be continuous.

## Tight beats

- **`ikkoku`** — **0.20s over its window.** The read runs past the cut. Trim two or three words and re-record, or give the beat one more tick.
- **`coda`** — **+0.64s.** It lands inside the window, but with almost no air either side, and the closing line is the one that most wants to be let go of slowly. One more tick would buy it.
