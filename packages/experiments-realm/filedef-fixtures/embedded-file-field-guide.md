---
deck: A field guide for FileDef embedded rendering—every leaf type rendered inline, backed by a licensed fixture in this directory.
---

# FileDef embeds, family by family

Every example below is the **embedded** format of a real realm file in this directory. The complex fixture is used so this document exercises representative content, metadata, and structure—not only minimum-valid format detection. Each family's introduction states the review contract: what a correct embedded rendering of that family looks like. A family whose FileDef subclass has not landed yet renders through the generic file shell; its section documents the target to review against as the subclass arrives.

Source, license, transformation, and structural-validation criteria are documented in [Fixture sources and licenses](./SOURCES.md) and the [Fixture quality audit](./QUALITY-AUDIT.md).

## Images

Images preserve their native composition inside a bounded reading-column figure.

### JPEG

::file[./samples/jpeg-complex.jpg|embedded]

### PNG

::file[./samples/png-complex.png|embedded]

### GIF

::file[./samples/gif-complex.gif|embedded]

### WebP

::file[./samples/webp-complex.webp|embedded]

### AVIF

::file[./samples/avif-complex.avif|embedded]

### SVG

::file[./samples/svg-complex.svg|embedded]

## Sampled audio and symbolic music

Native audio controls remain the primary interaction. MIDI parses the original sequence and draws its visualization from note events rather than decoded samples.

### MP3

::file[./samples/mp3-complex.mp3|embedded]

### WAV

::file[./samples/wav-complex.wav|embedded]

### M4A

::file[./samples/m4a-complex.m4a|embedded]

### Ogg Vorbis

::file[./samples/ogg-complex.ogg|embedded]

### FLAC

::file[./samples/flac-complex.flac|embedded]

### MIDI

::file[./samples/midi-complex.mid|embedded]

## Video

Each sample has a real video and audio stream. The embedded envelope keeps a stable widescreen stage and loads protected media as authenticated bytes for Safari-safe playback.

### MP4

::file[./samples/mp4-complex.mp4|embedded]

### WebM

::file[./samples/webm-complex.webm|embedded]

### QuickTime MOV

::file[./samples/mov-complex.mov|embedded]

## Text, code, and structured data

These formats favor wrapping, bounded scrolling, schema summaries, and tabular scanability over a forced media aspect ratio.

### Markdown

::file[./samples/markdown-complex.md|embedded]

### Plain text

::file[./samples/text-complex.txt|embedded]

### TypeScript

::file[./samples/typescript-complex.ts|embedded]

### Glimmer TypeScript

::file[./samples/gts-complex.sample.gts|embedded]

### JSON

::file[./samples/json-complex.data.json|embedded]

### CSV

::file[./samples/csv-complex.csv|embedded]

### XLSX

::file[./samples/xlsx-complex.xlsx|embedded]

## HTML documents and browser prototypes

HTML remains a real, linked file rather than markup copied into card JSON. Embedded and isolated views load that HTTP resource in an opaque-origin sandbox: authored JavaScript can demonstrate local interaction, but it receives no same-origin privilege, camera, microphone, or geolocation access. Fitted previews are inert.

### Interactive HTML

::file[./samples/html-complex.html|embedded]

## Paged and packaged documents

The original file remains canonical while the preview provides trustworthy orientation.

### PDF

::file[./samples/pdf-complex.pdf|embedded]

### DOCX

::file[./samples/docx-complex.docx|embedded]

### PPTX

::file[./samples/pptx-complex.pptx|embedded]

### ZIP

::file[./samples/zip-complex.zip|embedded]

## Fonts

Font leaves share one specimen renderer while retaining family-only typography metadata.

### WOFF2

::file[./samples/woff2-complex.woff2|embedded]

### WOFF

::file[./samples/woff-complex.woff|embedded]

### TTF

::file[./samples/ttf-complex.ttf|embedded]

### OTF

::file[./samples/otf-complex.otf|embedded]

## 3D manufacturing, interchange, and fallback bytes

The model adapter receives canonical GLB, embedded glTF, 3MF manufacturing packages, or ASCII/binary STL meshes. Camera distance derives from the loaded geometry and current card aspect ratio; orbit controls target the actual model center, so compact calibration parts, curved mechanisms, engineering lattices, and tall meshes all start fully framed and rotate around themselves. Unknown bytes remain honest: signature, size, download, and provenance without pretending to understand the format.

### 3MF

::file[./samples/three-mf-moderate.3mf|embedded]

### STL

::file[./samples/stl-complex.stl|embedded]

### GLB

::file[./samples/glb-complex.glb|embedded]

### glTF

::file[./samples/gltf-complex.gltf|embedded]

### Unknown binary

::file[./samples/binary-complex.bin|embedded]

---

## Composition contract

| Family         | Schema owns                                                                            | Renderer owns                                                |
| -------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Image          | dimensions, capture, location, color profile                                           | native image/SVG stage                                       |
| Audio          | duration, encoding, tags                                                               | waveform and native audio                                    |
| Music          | tracks, notes, tempo, meter, programs                                                  | piano roll and synthesis                                     |
| Video          | duration, dimensions, encoding, captions                                               | native video stage                                           |
| Text document  | language, words, lines, excerpt                                                        | wrapped prose/source                                         |
| Paged document | pages and document geometry                                                            | PDF/Office evidence                                          |
| Code           | language, lines, exports, imports                                                      | code/schema summary                                          |
| Data           | rows, columns, sheets                                                                  | grid/table projection                                        |
| Archive        | entries, expanded size, encryption                                                     | manifest projection                                          |
| Font           | family, style, glyphs, weight, axes                                                    | font specimen                                                |
| Model          | scene geometry and materials                                                           | orbitable 3D scene                                           |
| Web document   | title, language, DOM counts, scripts, styles, form controls, interactivity             | sandboxed HTML iframe and full-source copy                   |
| 3MF package    | units, physical bounds, build graph, print parts, resources, metadata, package entries | centered orbitable manufacturing model and package inspector |
| STL mesh       | encoding, solid/header identity, facets, normals, color data, bounds, degeneracy       | centered orbitable reconstructed mesh                        |

The inheritance tree controls field legality; preview components and resource primitives are composed independently through `static previewComponent` and the shared format shells.
