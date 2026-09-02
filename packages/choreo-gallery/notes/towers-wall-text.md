# Towers — the wall text, in and out

Every beat, from the beats in tower-film.gts. Times are seconds into the beat. A block is held at 0 through the incoming join plus 0.45 s, rises over 0.40 s, and is faded to 0 over the last 1.0 s before the next seam — on the block itself, so a leaver cannot return. Exits animate from wherever the text is. Both mechanisms are one code path for every beat (see frame(): enter / tailA), so the table is the schedule, not a claim per row.

| at   | beat     | join in | wall text                                                                                                                   | fade in     | fade out    | join out |
| ---- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | -------- |
| 0:00 | title    | glide   | A CONSTRUCTION STUDY · 天守 · Sixteenth-century Japan, Stone, timber, tile, And a roof you can see for miles,               | 0.45–0.85 s | 9.0–10.0 s  | glide    |
| 0:10 | shiro    | glide   | WHAT A CASTLE IS · 城 · Not the tower., The ground., Ditches, banks, terraces.                                              | 0.45–0.85 s | 13.0–14.0 s | melt     |
| 0:24 | what     | melt    | ONE BUILDING, THREE JOBS · 天守閣 · A lookout., A strongroom., An argument.                                                 | 2.35–2.75 s | 11.0–12.0 s | glide    |
| 0:36 | azuchi   | glide   | THE FIRST OF ITS KIND · 安土城 · 1576, Seven storeys. Gilded., Gone in six years.                                           | 0.45–0.85 s | 9.0–10.0 s  | flash    |
| 0:46 | teppo    | flash   | WHY THE SHAPE CHANGED · 鉄砲 · 1543 — the gun lands, Walls get lower, thicker, Height becomes address,                      | 0.75–1.15 s | 13.0–14.0 s | wipe     |
| 1:00 | ikkoku   | wipe    | AND WHY IT STOPPED · 一国一城令 · 1615, One castle per province, Twelve keeps survive                                       | 1.60–2.00 s | 13.0–14.0 s | wipe     |
| 1:14 | ishigaki | wipe    | STAGE ONE · 石垣 · No mortar. None., 扇の勾配 — the fan’s incline, The wall sheds the shock,                                | 1.60–2.00 s | 13.0–14.0 s | glide    |
| 1:28 | timber   | glide   | STAGE TWO · 柱梁 · A timber cage, Posts stand ON stone, The joints do the work                                              | 0.45–0.85 s | 13.0–14.0 s | glide    |
| 1:42 | plaster  | glide   | STAGE THREE · 白壁 · Lime over bamboo lath, 塗籠 — wrapped up, White because white will not burn,                           | 0.45–0.85 s | 7.0–8.0 s   | glide    |
| 1:50 | boro     | glide   | STAGE FOUR · 望楼 · A room to see from, The reason for all the rest                                                         | 0.45–0.85 s | 9.0–10.0 s  | glide    |
| 2:00 | kawara   | glide   | STAGE FIVE · 瓦 · Hung, not nailed, The heaviest thing here, And that weight is what steadies it,                           | 0.45–0.85 s | 11.0–12.0 s | blend    |
| 2:12 | muneage  | blend   | (no wall text)                                                                                                              | 0.97–1.37 s | 7.0–8.0 s   | glide    |
| 2:20 | detail   | glide   | LOOK CLOSER · 細部 · One building., One moment., Only the lens moves.                                                       | 0.45–0.85 s | 5.0–6.0 s   | blend    |
| 2:26 | shachi   | blend   | ON THE RIDGE · 鯱 · Tiger’s head, fish’s body, Bronze, at both ends of the ridge, A charm against fire,                     | 0.97–1.37 s | 11.0–12.0 s | blend    |
| 2:38 | hafu     | blend   | IN THE ROOF SLOPE · 千鳥破風 · A dormer named for a plover, Light and air into a deep floor, And a place to look down from, | 0.97–1.37 s | 11.0–12.0 s | blend    |
| 2:50 | koran    | blend   | AROUND THE TOP · 高欄 · A rail on a ledge, Too narrow to walk, Meant to be seen, not used,                                  | 0.97–1.37 s | 7.0–8.0 s   | blend    |
| 2:58 | ishi2    | blend   | AT THE FOOT · 扇の勾配 · Vertical at the top, Flaring at the foot, The shock runs into the hill,                            | 0.97–1.37 s | 13.0–14.0 s | blend    |
| 3:12 | noki     | blend   | AND THE REASON FOR ALL OF IT · 軒 · A metre of overhang, It keeps water off the wall, Style is drainage, first,             | 0.97–1.37 s | 15.0–16.0 s | glide    |
| 3:28 | hikaku   | glide   | ONE PROBLEM · 比較 · Six towers, One problem, Height, from what you have                                                    | 0.45–0.85 s | 7.0–8.0 s   | blend    |
| 3:36 | c-jp     | blend   | JAPAN · 天守 · Timber frame, stone skirt, Height by stacking roofs                                                          | 0.97–1.37 s | 7.0–8.0 s   | blend    |
| 3:44 | c-cn     | blend   | CHINA · 寶塔 · 斗栱 — bracket sets, Eaves far past the wall                                                                 | 0.97–1.37 s | 9.0–10.0 s  | blend    |
| 3:54 | c-vn     | blend   | VIETNAM · 佛塔 · A masonry body, A reliquary, not a lookout                                                                 | 0.97–1.37 s | 9.0–10.0 s  | blend    |
| 4:04 | c-th     | blend   | THAILAND · ปรางค์ · Tapering the whole way, The shape is a mountain                                                         | 0.97–1.37 s | 7.0–8.0 s   | blend    |
| 4:12 | c-kh     | blend   | CAMBODIA · ប្រាសាទ · Corbelled, never arched, So it must narrow to close                                                    | 0.97–1.37 s | 9.0–10.0 s  | blend    |
| 4:22 | c-tr     | blend   | TÜRKIYE · CAMİ · Mass in compression, A dome on an octagon, The height goes to the minaret,                                 | 0.97–1.37 s | 9.0–10.0 s  | blend    |
| 4:32 | kaitai   | blend   | AND BACK DOWN · 解体 · Tile, plaster, timber, Stone last, A hill with a shape in it, Enough to see from the fields,         | 0.97–1.37 s | 19.0–20.0 s | end card |

The last beat (kaitai) keeps its block through the end card by design; the end card fades over it.
