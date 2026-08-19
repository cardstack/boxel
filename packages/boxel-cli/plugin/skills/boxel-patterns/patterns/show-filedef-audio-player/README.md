---
validated: source-proven
---

# show-filedef-audio-player — play realm-stored audio without putting media in card JSON

**What this gives you:** A durable audio player card that links an MP3/WAV/OGG realm file through `FileDef`, optionally links cover art through `ImageDef`, and renders with native browser audio controls.

**When to use:** Music tracks, karaoke cards, podcasts, voice notes, recordings, or any card that needs to play an uploaded/generated audio file. Use this when an agent might otherwise store a `blob:`, `data:`, base64, or large provider URL in a `StringField`.

**The insight:** The audio bytes are a realm file, not card data. The hard-to-remember bit is the FileDef relationship syntax: import `FileDef`, use `linksTo(FileDef)`, and point the JSON relationship at the real file path with its extension (`.mp3`, `.wav`, etc.). The card renders `@model.mp3File.url`; it never owns the bytes.

The catalog `AudioField` has useful presentation variants, but its upload/edit model stores URL metadata inside a contained field. For durable workspace cards, use this FileDef-backed pattern first. If you wrap the catalog field UI later, feed it a FileDef URL rather than persisting a `blob:` URL.

**Gotchas:**

- Use `linksTo(FileDef)` for audio and `linksTo(ImageDef)` for cover art. FileDef instances have identity; never use `contains(FileDef)`.
- Relationship links to files should include the real extension: `./assets/track.mp3`, not `./assets/track`.
- Do not persist `URL.createObjectURL(file)` output. Object URLs are browser-local and die with the session.
- If audio is generated, write bytes with `WriteBinaryFileCommand` first, then link the returned file identifier.

**Source:** A Million Dreams karaoke FileDef example in `boxel-file-def/references/no-inline-binary.md` and `boxel-file-def/references/using-filedef-in-cards.md`; catalog audio field variants in `packages/catalog-realm/fields/audio.gts` and `field-spec/audio-field-spec.gts`.
