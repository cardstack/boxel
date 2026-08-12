# Fixture sources and licenses

Every supported FileDef leaf type has simple, moderate, and complex fixtures in this directory. The [integrity manifest](#integrity-manifest) at the end of this document records each file's byte length and SHA-256; the tables below record source, license, and attribution.

The three levels have different jobs:

- **Simple** is a minimum-valid or boundary fixture. Tiny files are intentional here.
- **Moderate** is a compact, normally authored file suitable for fast smoke tests.
- **Complex** is a representative real-world artifact that exercises structure, metadata, decoding, and visualization—not only magic-byte detection.

## Real-world complex samples

| Family / files           | Source artifact                                                                                                                                                                                                                                                                                                                                                 | License                                                                                                              | Validation value                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JPEG                     | [Hubble Mars mosaic](https://commons.wikimedia.org/wiki/File:Hubble_Mars_During_1999.jpg) and [Eagle Nebula](https://commons.wikimedia.org/wiki/File:Eagle_Nebula_-_GPN-2000-000987.jpg)                                                                                                                                                                        | Public domain, NASA/STScI                                                                                            | Two genuinely different 2845×1916 and 1944×1924 photographs in the moderate and complex tiers, varying orientation, color, texture, and available metadata. The simple tier is a minimum-valid boundary JPEG.                                                                                                                                          |
| GIF                      | [Spacefiller animation](https://commons.wikimedia.org/wiki/File:Spacefiller_animation.gif), [geyser animation](https://commons.wikimedia.org/wiki/File:Geyser_animation.gif), and [myosin animation](https://commons.wikimedia.org/wiki/File:Image_animated.gif)                                                                                                | Public domain; public domain; CC BY-SA 4.0                                                                           | Three different 443×421, 298×325, and 1100×600 animations with 99, 42, and 71 frames; the geyser animation is downscaled to half its source dimensions. They exercise rapid timing, diagram animation, scientific motion, palette decoding, and looping.                                                                                               |
| WebP                     | WebP quality-84 derivatives of [Keyhole Nebula](https://commons.wikimedia.org/wiki/File:Keyhole_Nebula_-_Hubble_1999.jpg) and [Crescent Nebula](https://commons.wikimedia.org/wiki/File:NGC_6888HSTfull.jpg)                                                                                                                                                    | Public domain, NASA/STScI                                                                                            | The complex fixture preserves its 1497×1517 source dimensions; the moderate fixture is an 800×517 downscale of its 2292×1480 source. The simple tier is a minimum-valid 1×1 WebP.                                                                                                                                                                      |
| PNG, AVIF                | [NASA Blue Marble](https://commons.wikimedia.org/wiki/File:Blue_Marble.jpg)                                                                                                                                                                                                                                                                                     | Public domain, NASA                                                                                                  | 1600×1200 photographic content plus embedded descriptive EXIF/XMP metadata. PNG and AVIF are format derivatives used to compare decode and metadata behavior.                                                                                                                                                                                          |
| SVG                      | [BlankMap-World-v2](https://commons.wikimedia.org/wiki/File:BlankMap-World-v2.svg)                                                                                                                                                                                                                                                                              | Public domain                                                                                                        | Large, human-editable SVG with country paths, borders, lakes, and microstate markers.                                                                                                                                                                                                                                                                  |
| MP3, WAV, M4A, Ogg, FLAC | [Auld Lang Syne, 1910 recording](https://commons.wikimedia.org/wiki/File:Auld_Lang_Syne.ogg)                                                                                                                                                                                                                                                                    | Public Domain Mark 1.0                                                                                               | A 30-second excerpt beginning at 00:15, transcoded into each target container/codec and tagged with title, artist, album, year, and provenance. The source recording is monophonic, so WAV (29 seconds) and FLAC carry a single 16-bit channel; the lossy codecs keep their duplicated stereo layout.                                                  |
| MP4, MOV, WebM           | [MDN Tears of Steel battle clip](https://github.com/mdn/shared-assets/blob/main/videos/tears-of-steel-battle-clip-medium.webm) from the [Blender Open Movie](https://mango.blender.org/)                                                                                                                                                                        | CC BY 3.0                                                                                                            | A 10-second excerpt beginning at 00:10, with real live-action/VFX motion and stereo audio. MP4/MOV use H.264/AAC; WebM uses VP9/Opus.                                                                                                                                                                                                                  |
| PDF                      | [MicroPython v1.26.0 documentation](https://docs.micropython.org/en/v1.26.0/)                                                                                                                                                                                                                                                                                   | MIT                                                                                                                  | The first 120 pages of the official 642-page technical manual, with chapters, code, diagrams, embedded fonts, and the complete bookmark outline; outline entries beyond the excerpt are inert.                                                                                                                                                         |
| DOCX                     | [Apache POI VariousPictures.docx](https://github.com/apache/poi/blob/trunk/test-data/document/VariousPictures.docx)                                                                                                                                                                                                                                             | Apache-2.0                                                                                                           | Word-authored OOXML with text, styles, and WMF, EMF, JPEG, and PNG media across 16 package parts.                                                                                                                                                                                                                                                      |
| PPTX                     | [Apache POI shapes.pptx](https://github.com/apache/poi/blob/trunk/test-data/slideshow/shapes.pptx)                                                                                                                                                                                                                                                              | Apache-2.0                                                                                                           | Six slides with text, shapes, hyperlinks, themes, and a preview image across 48 package parts.                                                                                                                                                                                                                                                         |
| XLSX                     | [Apache POI ConditionalFormattingSamples.xlsx](https://github.com/apache/poi/blob/trunk/test-data/spreadsheet/ConditionalFormattingSamples.xlsx)                                                                                                                                                                                                                | Apache-2.0                                                                                                           | Excel-authored workbook with 18 sheets, tables, styles, formulas, and conditional formatting across 132 package parts.                                                                                                                                                                                                                                 |
| ZIP                      | [p-map v7.0.3 source archive](https://github.com/sindresorhus/p-map/releases/tag/v7.0.3)                                                                                                                                                                                                                                                                        | MIT                                                                                                                  | Actual tagged release archive with nested directories, source, types, tests, CI configuration, package metadata, and license.                                                                                                                                                                                                                          |
| 3MF                      | Official [3MF Consortium sample repository](https://github.com/3MFConsortium/3mf-samples): calibration cylinder, [Heart Gears](https://github.com/3MFConsortium/3mf-samples/blob/master/examples/core/heartgears.3mf), and [beam-lattice spinal implant](https://github.com/3MFConsortium/3mf-samples/blob/master/examples/beam%20lattice/spinal%20implant.3mf) | BSD-2-Clause for the sample repository; Heart Gears carries embedded CC BY-SA terms and attribution to Emmett Lalish | Neutral, format-native fixtures progress from an 88-face core mesh to a 30,636-face printable mechanism and an engineering model with two build items plus 11,821 lattice beams. They validate units, authored metadata, dense curved geometry, multiple standard namespaces, camera fitting, and orbit interaction without project-specific branding. |
| STL                      | [Three.js STL fixtures](https://github.com/mrdoob/three.js/tree/dev/examples/models/stl) and [NASA Cassini printer model](https://science.nasa.gov/resource/cassini-3-d-printer-model/)                                                                                                                                                                         | MIT; public domain NASA                                                                                              | ASCII and binary encodings, a colored binary extension, coordinate bounds, 288–25,736 facets, and a NASA model with zero stored normals that validates client-side normal reconstruction.                                                                                                                                                              |
| BIN                      | [MicroPython ESP32_GENERIC v1.28.0](https://micropython.org/download/ESP32_GENERIC/)                                                                                                                                                                                                                                                                            | MIT                                                                                                                  | The first 256 KiB of the official production firmware image — bootloader, partition table, and application header with recognizable build and target strings; validates opaque-binary fallback and byte integrity.                                                                                                                                     |
| HTML                     | Original works authored for this fixture set                                                                                                                                                                                                                                                                                                                    | CC0 1.0 / public-domain dedication                                                                                   | A formatted release report, a polished product landing page, and a self-contained interactive dispatch-board UI mockup validate distinct HTML authoring purposes, authored CSS, responsive flow, DOM metadata extraction, sandboxed JavaScript, and complete source copying without external resources or inline binary payloads.                      |

## Other representative sources

| Source                                                                           | License                                           | Used for                                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Cardstack / Boxel](https://github.com/cardstack/boxel)                          | MIT                                               | Real TypeScript, GTS, JSON, Markdown, and plain-text source files.                             |
| [Vega datasets](https://github.com/vega/vega-datasets)                           | BSD-3-Clause; dataset notes apply                 | Real tabular CSV datasets. `csv-simple.csv` is a valid three-row excerpt from the stocks data. |
| [Font Awesome Free](https://github.com/FortAwesome/Font-Awesome)                 | SIL OFL 1.1 for fonts                             | OTF/WOFF/WOFF2 font programs and glyph coverage.                                               |
| [Google Fonts](https://github.com/google/fonts)                                  | SIL OFL 1.1                                       | Roboto and Open Sans TTF fixtures.                                                             |
| [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) | Model-specific: Box public domain; Duck CC BY 3.0 | Real glTF and GLB scene assets.                                                                |
| [Mutopia Project](https://www.mutopiaproject.org/)                               | Public-domain editions for selected scores        | Bach and Beethoven MIDI files, including a 15-track General MIDI arrangement.                  |

## Boundary fixtures

[Sindre Sorhus/file-type](https://github.com/sindresorhus/file-type/tree/main/fixture) (MIT) and [Mathias Bynens/small](https://github.com/mathiasbynens/small) (CC0) supply minimum-valid, detector, truncation, and empty-file fixtures. They are not used as evidence that a complex renderer is complete. `jpeg-simple.jpg` and `png-simple.png` are that repository's minimum-valid JPEG and 1×1 transparent PNG; `webp-simple.webp` is a 1×1 WebP encoded from the same 1×1 PNG.

## Integrity manifest

Fixture bytes are committed to the repository and served by the realm directly from disk. The `samples/` tree is exempt from repository formatting tools so these bytes stay stable; any intentional change to a fixture must update its row here. A mismatch between this manifest and the file on disk means the fixture no longer matches its recorded provenance.

| File                            | Bytes   | SHA-256                                                          |
| ------------------------------- | ------- | ---------------------------------------------------------------- |
| samples/avif-complex.avif       | 171775  | 33797c0410db620c1d062eb34aadf39bad2abff750ff19a6e00a434249672506 |
| samples/avif-moderate.avif      | 165908  | a754543bc9348cae394a17f537209bd52dd9c598d89abc4f989e8c82a407e1d6 |
| samples/avif-simple.avif        | 871     | c627d1272e4b3a0315caf3d9367324121502373af9a403bfa7b78c0ea3df9a97 |
| samples/binary-complex.bin      | 262144  | 2ca678c3a5a89ea9a5920d018fa5ecc8a726a8038f397f6a5b93edd15080d952 |
| samples/binary-moderate.bin     | 8192    | 0d379a9e9f00803166d06a070c89d8a06779b01edbda7d112e8d5ec054ed62f0 |
| samples/binary-simple.bin       | 4096    | 23045ee53ee82eb9b4f6b672e6f01793d0ac40797a87d6aec3e81832da35977a |
| samples/csv-complex.csv         | 210363  | caeb10d97cf2946792f7f2b4e28b692c655bb6c5f0a8e048ea3625b538266dd3 |
| samples/csv-moderate.csv        | 12245   | f9953ac6693e587476b4ebf2f0b00d9bb95371ca8c39da4cc6155077b3e417cd |
| samples/csv-simple.csv          | 84      | 4aa41ce8e6ce00ad941b42114709182898a9c3a49cd70cf6771ade5047d1fdf9 |
| samples/docx-complex.docx       | 103677  | c1eecbca7de9f99e21c677e1d5b045eaa1d5a442eff4c82f0cbe9af93726a070 |
| samples/docx-moderate.docx      | 6482    | 835e2b250b13ca29eb0025640fd6770d7627782678927d09c3d08d8d9b524f23 |
| samples/docx-simple.docx        | 5897    | 4169a1a588831fa6ea6b95f4d10aa1b5331ead998b16f0bf78a151539b63b77b |
| samples/flac-complex.flac       | 1137028 | f8f0b8b61108548588e06dc75de32e73a0993cac74840917b384f9cb0de11289 |
| samples/flac-moderate.flac      | 212209  | f63b4ecc62117e1115df4181bfa2f2d717c4aae814d2594977bfdd5b83b69a07 |
| samples/flac-simple.flac        | 38108   | 08416a7cc0686de136f5726196f449c3a8dbdf53d79f2c112d8a9f42a500354c |
| samples/gif-complex.gif         | 817344  | 8832a90a9258d23a13b7c35f34f2dfe3bb1194a8cb31edeb209bdab13485aa51 |
| samples/gif-moderate.gif        | 144316  | 53a8b0e049c2b2c7913b601aad18c453e6e94ed9d7236d83ef992c3fbf51deb4 |
| samples/gif-simple.gif          | 105792  | 26ccfbb403bbb59ce5b716accf250941275fe5be8a468d87ee22761c821fa03e |
| samples/glb-complex.glb         | 120484  | 65bf938f54d6073e619e76e007820bbf980cdc3dc0daec0d94830ffc4ae54ab5 |
| samples/glb-moderate.glb        | 5956    | b510eca2e2ef33f62f9ed57d6e7ce2d10ebb2bdebc4a8e59d347719ba81abdf4 |
| samples/glb-simple.glb          | 1664    | ed52f7192b8311d700ac0ce80644e3852cd01537e4d62241b9acba023da3d54e |
| samples/gltf-complex.gltf       | 162796  | b69c34f30ec2803a37c6546c890a202f4db618745a3fefa3e5ac360bff211931 |
| samples/gltf-moderate.gltf      | 9840    | 879feb174dbf48e9e0cb22d2402ab35ff8519e13f0c5a100676788712dc3c8c7 |
| samples/gltf-simple.gltf        | 3791    | f98a369e29ffc754cc897f78d695754ac6812ba7ddcd23705dd8d4e258f5f13b |
| samples/gts-complex.sample.gts  | 1123    | b4ec7a2d4650c109d4c4dc362767f2cd269522acfe2f323e5721dcf3df58e873 |
| samples/gts-moderate.sample.gts | 784     | 798b1b7cddbc5023e2ae8bccf5a3b391f62494f431eba9420af6acac937c125c |
| samples/gts-simple.sample.gts   | 333     | 07b2e6d9a45b53e2086fa02e83174533e1fc157ef5b21fec5bf6831a4c79a706 |
| samples/html-complex.html       | 10048   | f35ad0dbe526c166be942ea2f3317e64d60e6835b200bff5130ba9337eb1f835 |
| samples/html-moderate.html      | 4379    | 1c64770b77b761dc7ba7b2eb6c4073ef7831993cc65eb35ee4e688d9cb45cf72 |
| samples/html-simple.html        | 2988    | f447a195c8eacb6b2dddfe722cf13de9b05eef08ac23d2121b38a9e70f522bf7 |
| samples/jpeg-complex.jpg        | 1237372 | 823fe9b6e617452d487562d3be13e23842e7f470fe41a6bce48131ff831ad9a2 |
| samples/jpeg-moderate.jpg       | 218565  | a0096940e7a680471f2bdb2abb1e6f3aeb64d202e2dd5a900ccc29233ac17057 |
| samples/jpeg-simple.jpg         | 107     | 0b8d8b5f15046343fd32f451df93acc2bdd9e6373be478b968e4cad6b6647351 |
| samples/json-complex.data.json  | 3109    | b53b02df378b1781efbf37d61071d2dcb2a987eb8d44d229a75de3888f7dc8fa |
| samples/json-moderate.data.json | 3511    | 52a541a786bde5c07b3178083472152c1c22c392cd8b6913bd3970318c7c9bfc |
| samples/json-simple.data.json   | 1       | 5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9 |
| samples/m4a-complex.m4a         | 732689  | 6d1880cbce63d44352110d57c5a66662436fd45c93c480c12d1d8ceaa6c46316 |
| samples/m4a-moderate.m4a        | 60482   | 25df0aeddd859b87545d4e89ec646c8c8a3de76445906876ce9923ff3313deda |
| samples/m4a-simple.m4a          | 10666   | 7a07cb6b46f7bdd100fcf1810c8520647be98a4634b04fdf58e5810f17454551 |
| samples/markdown-complex.md     | 19586   | 40b7538276e1ecf86d1224b93bd147a2819a4dd4c67f8650c825e7da757c8447 |
| samples/markdown-moderate.md    | 32073   | ceafcbbead5e122a00ddf2290022b43b2a3de2af3d568df7f4b1444713270876 |
| samples/markdown-simple.md      | 306     | 4a97deea971c74d310879acfd2cdeff88374c59f2d413e0ec8e280dbe669bb7d |
| samples/midi-complex.mid        | 111434  | f189d4dfbd6058a144555393bfd3f116e751310ffb5134a5b98193ba92ba548e |
| samples/midi-moderate.mid       | 4676    | 874e07d0479542971bfceaf420d6117da8d602d89d26eea4610e7dd1ef58bf26 |
| samples/midi-simple.mid         | 248     | a1259360c48adc81f2c5b822f221044595632bd1a76302db1f9d983c44f45a30 |
| samples/mov-complex.mov         | 1071202 | 9fda8c982324f1b6dc35332d1a954e47a93fc6363968de89cae9b007f9fd8270 |
| samples/mov-moderate.mov        | 56287   | 1bf53b126c551e332ca6b7fd9f69e0515f3cc1c97d17fce20ceed76035c22d7d |
| samples/mov-simple.mov          | 21700   | 42fb664faa92e8dcf7bcb697f82f2180c1e98ebc63ef7f1393b36e11997a7334 |
| samples/mp3-complex.mp3         | 721853  | 23f650e17e84d174bfaa4f3ba0b3bf30626b929d32fffd91f7046a8c3dac938c |
| samples/mp3-moderate.mp3        | 58558   | 9649f77ea6c48e34fcd1b29612cddb111fd22bd0282b184a278e449645226722 |
| samples/mp3-simple.mp3          | 7750    | 0e17c2eeb622041ca71161d1deacb5e3bb352e8de123ad6f8dff0304d2ac6da8 |
| samples/mp4-complex.mp4         | 1071089 | 8c923853036552d9ba75ee041cf992798a754f6e0621bf25590f4a1d89f0f67b |
| samples/mp4-moderate.mp4        | 56258   | 79807246f4a09e2273591346569c14f321f6338d280aafa049ddd255061b8709 |
| samples/mp4-simple.mp4          | 21583   | 4082f98a516ce53fbe8c0cce3080502cc9438014242f9b4d0be5c48a8e9bbc86 |
| samples/ogg-complex.ogg         | 431173  | 85fa8f5bc2e27dcf8cb0a745d62a5e04430f19c4a7c71d603b3f4f6f21be7e8b |
| samples/ogg-moderate.ogg        | 55509   | 4b359550653ecd30f952d30be804d9c9c2c74c7e63ae4d874f4dbfb82a9f15c8 |
| samples/ogg-simple.ogg          | 9017    | 6b78ebe03dc42f5b139cf02d626fd4b92ae8892c3a7d6e0012d6491e56180775 |
| samples/otf-complex.otf         | 1049188 | 79404128c17cae94c63075dec7b869f779992638e0d9652a3beb89ad88588912 |
| samples/otf-moderate.otf        | 191468  | 7cfc5844bdcb2e3678fe68412bde5507567873f9d9d469cc37c582e6234ae86c |
| samples/otf-simple.otf          | 93888   | bdc5d0b9f397be83e886c74b0141d1954aa4384b359dce49829994c4a2e1f7bf |
| samples/pdf-complex.pdf         | 631939  | 8b0f46a9a25725d69c8dc242bb56a668e6088a6912f48f05183184f99da5847f |
| samples/pdf-moderate.pdf        | 7945    | 60bdd13ea4827b8de375c79dc3ff847f83b55bd73b6461523fdf8f843b5a0d5b |
| samples/pdf-simple.pdf          | 130     | d18981866d1600d0f39eab26745e87335a1ee95a6fe5c82748d6d93604a8aa32 |
| samples/png-complex.png         | 2914899 | e1f84a5f6d706654045fb4236a84c30d0a908b974f320f9f9d35390130c46394 |
| samples/png-moderate.png        | 54318   | 0fcb56fdef19dde2af4c135514a33ff6325aad4d0a01fd7893d715dc14ae0d50 |
| samples/png-simple.png          | 67      | ebf4f635a17d10d6eb46ba680b70142419aa3220f228001a036d311a22ee9d2a |
| samples/pptx-complex.pptx       | 68822   | 19fde9b87e33dd1a95fdbba0cf6abc2278bf03874f4665c7f8b88b6afe4a2571 |
| samples/pptx-moderate.pptx      | 47219   | 44a7d14a137f59d4328659f38b8531477ccf09fb0559f4d2495ae8d8a308e7db |
| samples/pptx-simple.pptx        | 30226   | daad647369762d66974948aa06600b45bf029b1020486d1b5455ba4cca5d7502 |
| samples/stl-complex.stl         | 1286884 | 1952b004b0b3f58578df6021b92c4ff9d3d2d8f006f095711e6859edf73a5844 |
| samples/stl-moderate.stl        | 107884  | 0012b62d4bb485f902a972192eef29d6ce4b97a9deb2de67a02d30a5b738f461 |
| samples/stl-simple.stl          | 80861   | 5c0d95ca55352ccf5cca12197a5f9fa17eb2e905d1bb3a45c8ba51c9a22699a4 |
| samples/svg-complex.svg         | 1379307 | 2d835fb5ca7086db175b89850e6bca609feb335f5214988b1467b09b35e4d984 |
| samples/svg-moderate.svg        | 1294    | 7f023e8d1e767370306ec9437d2de5d5af97491d6208dd7799a3808a7c10a36a |
| samples/svg-simple.svg          | 822     | 3bf8cceead820aec50d4ee825a3fd02c5a1cd6665cc9cf4cbf3d9c8861a204bb |
| samples/text-complex.txt        | 19586   | 40b7538276e1ecf86d1224b93bd147a2819a4dd4c67f8650c825e7da757c8447 |
| samples/text-moderate.txt       | 5227    | 537eb08ff2470d3315a036426f5791123dae967ab4bd04c88660b67bea1c792d |
| samples/text-simple.txt         | 1117    | 5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3 |
| samples/three-mf-complex.3mf    | 261883  | 9b4b7d43e071b2b7d4b9cd38031c63f598a0064090acec50696a849da40536e8 |
| samples/three-mf-moderate.3mf   | 382238  | 5fa8cc9b273a108b9da3ad590512abbb63498deec33968d16b75e877d65b4fe0 |
| samples/three-mf-simple.3mf     | 1833    | 2a263ec8c0e35a677b3a3fc97941f4596a8df3c071bac94551a4512ae95ca086 |
| samples/ttf-complex.ttf         | 532636  | 36643644f318a812aab2d2ed3bb98f8cf0872527f835fe9398d95fe6b9adb878 |
| samples/ttf-moderate.ttf        | 488584  | d7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134 |
| samples/ttf-simple.ttf          | 122092  | 9e540a087924a6e64790149d735cac022640e4fa6bff6bd65f5e9f41529bf0b3 |
| samples/typescript-complex.ts   | 10001   | b73d335dcec89f99f294a74fc4b6ab6e77f164ba63da6a7f902ae327b74ddc93 |
| samples/typescript-moderate.ts  | 6159    | d2d6094d2e2b2a6ffdd061957b60ee64f6dd6f1092a66b70e13dc52058db1c13 |
| samples/typescript-simple.ts    | 34      | 5bebe5892144e93811698b7ea8f0b449227c33d057fd3c08294e32e94fe2524a |
| samples/wav-complex.wav         | 2557956 | 6200794cc32d55c90270834b2198346a1d1e2be82db372874c75b410a000a05d |
| samples/wav-moderate.wav        | 317598  | 734d1ebff54cdc332b9479f50a823e51617219cdd38f192aeee954b43f8d5299 |
| samples/wav-simple.wav          | 19278   | 519082b722210317caa0a97f00b82c64600d18fca3d3c5f2bbe90904e933c670 |
| samples/webm-complex.webm       | 676661  | b857a612a86f70f1c480a66385f2880d2af175b15b0a01297b0152c0e83788ac |
| samples/webm-moderate.webm      | 54893   | eda6c6da980cecd7a0a7707f321a35eda59c29fe73921150973bbaa131ecdc0d |
| samples/webm-simple.webm        | 18052   | 2220daca343270de598c5021acc42bb062d7138aa0cc550739d749f7e8616b4a |
| samples/webp-complex.webp       | 701620  | dac9c9c24efa2ef7cd9a1899306bd0d34ff5d78fa0f206536cca353d3ce7a68d |
| samples/webp-moderate.webp      | 42982   | e10fc658effe6a30e791f3cb160590474f9d595c9a347b9930040f80968df032 |
| samples/webp-simple.webp        | 72      | 78314b2a0afc11f8512802517d3497f25e333e4a858293af2e2deb62c99753ff |
| samples/woff-complex.woff       | 71508   | e3870de89716b72cb61a4bba0e17c75783b361cdaba35ea96961c3070bd8ca18 |
| samples/woff-moderate.woff      | 98024   | ba0c59deb5450f5cb41b3f93609ee2d0d995415877ddfa223e8a8a7533474f07 |
| samples/woff-simple.woff        | 35988   | 983ea6b57e4bcfcc780c7b53214bd3e1f345f94f8c643b2d8354be87a545ab34 |
| samples/woff2-complex.woff2     | 56780   | aadc3580d2b64ff5a7e6f1425587db4e8b033efcbf8f5c332ca52a5ed580c87c |
| samples/woff2-moderate.woff2    | 158220  | 6a3b4536c389c82a2a2e160e7ab15f6c8acef77f42e04d4c697f1cbfa9e90026 |
| samples/woff2-simple.woff2      | 21176   | 1e31c9381fb593079d45c178bbf87a1cad90e4105d743a9f585c68a97453d6ae |
| samples/xlsx-complex.xlsx       | 654688  | 8dfa997a642c00a1da8c0750c371f204553a98c537ca046028b052f9b424a074 |
| samples/xlsx-moderate.xlsx      | 8564    | f324c2b9d7990894a08ceef72616bc51940ba255c980b45d965073ebe1af7cfd |
| samples/xlsx-simple.xlsx        | 4711    | 0de0b1734fc06cc7f30dd5489833da6858e167aba1846fcc9aaaf85b43d2871f |
| samples/zip-complex.zip         | 15467   | b417ad1473e83264d732ae3454a2cf78eb3306580a08b8262b175f0071a502c3 |
| samples/zip-moderate.zip        | 2224    | 83d8eaeee176aa0907d6a466f38642bb4c9991e40452362106f845b7ee3eb280 |
| samples/zip-simple.zip          | 199     | 626a73fa969342468fa36c0d5bfab13b318078039c4852b4df91612d7d1500fb |
