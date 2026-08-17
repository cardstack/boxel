# Fixture quality audit

This audit prevents a format-detector fixture from masquerading as renderer validation.

## Acceptance gates

1. **Identity:** `file`, ExifTool, or an equivalent parser recognizes the intended container.
2. **Structural integrity:** container-specific checks pass (`ffprobe`, `pdfinfo`, ZIP CRC tests, OOXML/3MF package inspection, font scan, MIDI parser, or glTF parser).
3. **Representative content:** the complex file contains meaningful content produced by the format's normal ecosystem.
4. **Feature coverage:** the file exercises metadata or structure the UI claims to visualize.
5. **Browser relevance:** browser media uses a deliberate, compatible codec combination; unsupported combinations remain explicit test cases rather than accidental failures.
6. **License and provenance:** a stable source page, license, attribution, transformation note, byte length, and SHA-256 are recorded in [SOURCES.md](./SOURCES.md).
7. **Repository integrity:** the bytes on disk match the integrity manifest in [SOURCES.md](./SOURCES.md).
8. **Client audio decode:** each sampled-audio family decodes through Web Audio and yields nonuniform waveform bars with duration, sample rate, and channel count.

## Complex-sample coverage

| Type                     | Representative feature exercised                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AVIF                     | Real photographic decode, 1600×1200, embedded descriptive metadata                                                                                                              |
| BIN                      | Official ESP32 firmware prefix (256 KiB) and opaque-binary fallback                                                                                                             |
| CSV                      | Real Vega tabular dataset; the simple fixture is a valid three-row stocks excerpt                                                                                               |
| DOCX                     | OOXML text/styles plus four embedded image formats                                                                                                                              |
| FLAC                     | Real performance, lossless audio, tags, nontrivial waveform                                                                                                                     |
| GIF                      | Three distinct 298×325 to 1100×600 animations with 42–99 frames and different timing/motion profiles                                                                            |
| GLB / glTF               | Khronos Duck scene, mesh, material, and texture                                                                                                                                 |
| GTS / TypeScript         | Real Boxel source modules                                                                                                                                                       |
| HTML                     | Three original semantic documents cover a formatted report, a responsive product landing page, and a self-contained UI mockup with search, filters, density, and theme controls |
| JPEG                     | Two distinct 2845×1916 and 1944×1924 NASA/STScI photographs with varied orientation and metadata, plus a boundary JPEG in the simple tier                                       |
| PNG / AVIF               | Real photographic decode and metadata                                                                                                                                           |
| WebP                     | NASA/STScI sources transcoded at quality 84: the complex fixture preserves its 1497×1517 dimensions, the moderate fixture is an 800×517 downscale                               |
| JSON / Markdown / text   | Real Boxel project and documentation content                                                                                                                                    |
| M4A / MP3 / Ogg / WAV    | Real historic recording, tags, codec-specific metadata                                                                                                                          |
| MIDI                     | Real 15-track General MIDI arrangement                                                                                                                                          |
| MOV / MP4 / WebM         | Real open-movie footage, motion, stereo audio, keyframes                                                                                                                        |
| OTF / TTF / WOFF / WOFF2 | Real installable font programs with broad glyph sets                                                                                                                            |
| PDF                      | First 120 pages of the official technical manual, with chapters, code, diagrams, fonts, and bookmarks                                                                           |
| PPTX                     | Six-slide deck with shapes, themes, hyperlinks, and preview                                                                                                                     |
| SVG                      | Large path-heavy political map                                                                                                                                                  |
| XLSX                     | 18 sheets, formulas, tables, styles, conditional formatting                                                                                                                     |
| ZIP                      | Actual tagged source archive with nested entries                                                                                                                                |
| 3MF                      | Official 3MF Consortium fixtures spanning a calibration mesh, a dense printable mechanism, and a beam-lattice engineering model with standard extension namespaces              |
| STL                      | ASCII and binary meshes, colored-facet extension, coordinate bounds, 288–25,736 facets, and NASA Cassini with zero stored normals                                               |

## Intentional simplicity of the simple tier

Simple fixtures remain minimum-valid edge cases by design. Moderate samples stay small enough for fast smoke testing; a moderate detector fixture whose content does not exercise the corresponding embedded view is a candidate for replacement, not a defect in the tier system.
