# Photographs for the Towers film

The film at `/_towers` cuts a photograph in beside the model at four
moments. Drop the files here and they appear; leave the folder empty and
the plates simply do not render, which is why the film is shippable
either way.

| file              | the moment it lands on                       |
|-------------------|----------------------------------------------|
| `azuchi.webp`     | 安土城 — Nobunaga's keep, 1576                |
| `himeji.webp`     | 一国一城令 — the twelve surviving originals    |
| `ishigaki.webp`   | 石垣 — dry-laid stone, the fan's incline      |
| `shachihoko.webp` | 鯱 — the bronze roof-ridge fish               |

Landscape, roughly 3:2, 1200px wide is plenty — the plate is at most
340px across and the film desaturates it slightly to sit with the scene.

Set each one's credit line in `app/components/tower-film.gts` (the beat's
`photo.credit`). A museum caption without a credit is a caption nobody
can check, so the field is not optional in practice even though the type
allows anything: put the photographer or the source there before this
goes anywhere public, and make sure the licence actually permits it.
