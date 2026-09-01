# TOWERS — pronunciation layer for the voiceover

Companion to `docs/towers-vo.md`, which is generated from the beats and is the
authority on WHAT is said and WHEN. This file is hand-authored and is the
authority on HOW the foreign words are said. Nothing here changes a line's
words or its window.

## The rule

The speaker is British, of East-Asian background. The English is British
throughout — flat numbers, no American r, "metre" not "meter". The foreign
words are the exception: they are said in their own phonology, not
naturalised into English. A British narrator who says "bee-WAH" is
anglicising; one who says "bee-wah", evenly, is simply saying the word.

Japanese is mora-timed and flat. Every syllable gets the same length and no
syllable gets an English stress hammer. `ō` and `ū` are one vowel held for two
beats — never "oh-oo". A doubled consonant is a held stop, a tiny silence
before the release. Final `-e` is always "eh", never silent.

## Key

| Term | Written | Say it as | Watch for |
|---|---|---|---|
| 琵琶湖 | Lake Biwa | bee-wah | two even syllables; not "bee-WAH", not "BYE-wa" |
| — | Türkiye | tur-kee-yeh | three syllables, ü as in French *tu*; not "Turkey" |
| 天守 | tenshu | ten-shoo | long oo; not "ten-shuh" |
| 城 | shiro | shee-roh | |
| 天守閣 | tenshukaku | ten-shoo-kah-koo | |
| 安土城 | Azuchi-jō | ah-zoo-chee joh | jō is one long syllable |
| 織田信長 | Nobunaga | noh-boo-nah-gah | four even beats, no stress peak |
| 鉄砲 | teppō | tep-poh | hold the p, then the long o |
| 一国一城令 | ikkoku-ichijō-rei | eek-koh-koo ee-chee-joh ray | |
| 姫路 | Himeji | hee-meh-jee | flat; not "him-EDGE-ee" |
| 石垣 | ishigaki | ee-shee-gah-kee | |
| 扇の勾配 | ōgi no kōbai | oh-ghee no koh-bye | hard g |
| 柱梁 | chūryō | choo-ryoh | ryo is ONE syllable |
| 白壁 | shirakabe | shee-rah-kah-beh | final -beh sounded |
| 望楼 | bōrō | boh-roh | both long |
| 瓦 | kawara | kah-wah-rah | |
| 細部 | saibu | sigh-boo | |
| 鯱 | shachihoko | shah-chee-hoh-koh | |
| 千鳥破風 | chidori-hafu | chee-doh-ree hah-foo | |
| 高欄 | kōran | koh-rahn | |
| 軒 | noki | noh-kee | |
| 比較 | hikaku | hee-kah-koo | |
| 寶塔 | bǎotǎ | bough-tah | Mandarin third tones: dip and rise, don't clip |
| 斗栱 | dǒugǒng | doh-goong | |
| 佛塔 | tháp | thahp | Vietnamese; aspirate the t, rising tone |
| ปรางค์ | prang | prahng | Thai; long a, no g release |
| ប្រាសាទ | prasat | prah-saht | Khmer; weight on the second |
| Cami | cami | jah-mee | Turkish c is j |
| — | minaret | mi-na-ret | even, British; not "MIN-a-ret" |

## Canonical read

The lines in `docs/towers-vo.md` are recorded verbatim. Only two carry a
foreign word, and both are respelled for the take:

- **`azuchi`** — "Fifteen seventy-six. Seven gilded storeys over Lake bee-wah.
  It burned in six years. Everything after it is a reply."
- **`c-tr`** — "Tur-kee-yeh answers backwards. Mass in compression, a dome on
  an octagon, and the height handed to a minaret."

The country names in chapter 05 stay English — Japan, China, Vietnam,
Thailand, Cambodia — because the line is addressed to an English listener and
a sudden native pronunciation of one country name in a list of six reads as a
stumble, not as care.

## Named-term alternates

The generated script keeps the Japanese terms off the voice track on the
grounds that the screen already carries the kanji. That is a defensible cut,
and these are the alternate takes for the other choice: the term named aloud,
correctly, as the beat's first word. Each fits its existing window — the term
costs between 0.5 and 1.1 seconds, and every one of these beats has that much
air in it.

**ADOPTED, 2026-09-01.** All ten alternates were recorded and are now the
canonical `<id>.mp3`; the takes that do not name the term are kept beside
them as `<id>-plain.mp3`. Each beat's `vo` in the component was updated to
match what is spoken, and `docs/towers-vo.md` regenerated from it.

One correction to the estimate above: the named takes did NOT all fit their
existing windows. Four ran over — ishigaki by 1.5s, timber by 0.8s, shachi
by 0.6s, hafu by 0.2s — because a re-record varies by more than the cost of
the added word. Those four beats were widened by a tick each rather than the
reads being rushed, and the film went from 4:00 to 4:14. Measure, do not
estimate: the headroom column in `towers-vo.md` is now ffprobe output.

| Beat | Window | Alternate line (as spoken) |
|---|---|---|
| `title` | 10s | **Ten-shoo.** You know the shape. Almost nobody knows what is holding it up. So let us take one apart. |
| `ishigaki` | 10s | **Ee-shee-gah-kee.** Dry stone, no mortar, stacked into a curve. A straight wall argues with an earthquake. This one passes it into the hill. |
| `timber` | 12s | **Choo-ryoh.** Above the stone, a timber cage. Posts sit on footing stones, not in the ground. Nothing is bolted. The joints do the work. |
| `plaster` | 8s | **Shee-rah-kah-beh.** Lime plaster, thick enough to be armour. White, because white does not burn. |
| `boro` | 10s | **Boh-roh.** At the top, one room you can see out of. Everything below it is how you get that room into the air. |
| `kawara` | 12s | **Kah-wah-rah.** Fired clay, hung, never nailed. The heaviest thing in the building, and that weight is what holds it still. The roof is ballast. |
| `shachi` | 10s | **Shah-chee-hoh-koh.** Tiger's head, fish's body, cast in bronze. It swallows water and spits it on the roof. That was the fire plan. |
| `hafu` | 10s | **Chee-doh-ree hah-foo.** Named after a plover. Light and air for a deep floor. Also somewhere to stand and look down at you. |
| `koran` | 8s | **Koh-rahn.** A rail on a ledge too narrow to walk. Built to be seen, not used. |
| `noki` | 12s | **Noh-kee.** A metre of overhang. Every line you have admired is a way of keeping rain off earth and wood. Wait for weather; the styling explains itself. |

A term named aloud is said ONCE, at the head of its beat, and then never
again in that beat — the screen is holding it, and a narrator who repeats a
word the audience is currently reading sounds like he does not trust them.
