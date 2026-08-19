---
validated: source-proven
---

# integrate-three-js-3mf-fabrication — Build validated multicolor parts for 3MF export

**What this gives you:** A reusable geometry and export discipline for Boxel tools that turn Three.js shapes, SVG paths, or text into independently assignable 3MF parts.

**When to use:** Configurators that generate multicolor plaques, labels, enclosures, badges, reliefs, inlays, or other printable assemblies for slicers that understand 3MF components.

**The insight:** visual alignment in a WebGL preview is not enough. A printable assembly needs an explicit finish model, closed welded meshes, stable component coordinates, color-to-extruder mapping, and post-export validation. Raised relief and flat/flush inlay are different solids; one cannot be implemented as a cosmetic Z offset of the other. Here, **flat means flush with the backing surface**, not a zero-height feature laid over an uncut backing.

## Choose the finish before building geometry

| Finish | Backing | Feature solid | Contact rule |
|---|---|---|---|
| **Raised relief** | Uncut | Starts slightly inside the backing and ends above it | Small intentional overlap prevents a floating coplanar part |
| **Flat / flush inlay** | Matching cavity subtracted | Occupies the cavity and ends exactly at the backing surface | Cavity cutter slightly overtravels its intended bounds so Boolean subtraction has no coincident faces |

For raised parts, place the feature bottom at `surfaceZ - overlap` and extrude through `reliefDepth + overlap`. Merely touching the backing at `surfaceZ` can be classified as a floating region.

For flush parts, create the inlay at its exact printable depth, then subtract a separate cutter that is slightly deeper than the inlay and crosses the surface by a small epsilon. Do not export two materials occupying the same backing volume; the cavity belongs to the backing geometry.

Keep overlap and overtravel small relative to the printer and model scale. They are robustness tolerances, not visible design dimensions.

## Normalize paths before extrusion

- Keep geometry transforms orientation-preserving. Do not mirror completed `ExtrudeGeometry` with a negative axis scale; a negative determinant reverses triangle winding after cap triangulation and can produce culled or missing cap triangles.
- Convert source paths into the intended coordinate system before `SVGLoader.createShapes()`, then apply positive X/Y scale and translation.
- When converting fonts or other compound paths, normalize contour winding before generating Three.js shapes. Test counter-heavy glyphs or nested paths so holes remain holes.
- Assert the generated bounding box. With Three.js versions where `TextGeometry` maps extrusion through the legacy `height` option, passing `depth` can silently produce the default extrusion. Treat this as version-specific and verify the Z span rather than trusting the option name.

## Weld and validate every exported mesh

`ExtrudeGeometry` is commonly non-indexed. Writing each position as a unique 3MF vertex makes every triangle look disconnected to a slicer. At export time:

1. Transform vertices into shared assembly coordinates.
2. Quantize them at the same precision used by the XML serializer.
3. Reuse one index for each quantized coordinate.
4. Drop triangles whose welded indices collapse together.
5. Count undirected edges; a closed manifold mesh uses every edge exactly twice.
6. Assert expected X/Y/Z bounds for every component and for the full assembly.

Do not rely on stored vertex normals as proof of printable topology. Validate indices and edge use after all transforms.

## Package multicolor 3MF by component

A combined STL has no durable material assignment. A portable 3MF assembly uses one mesh object per printable part, stable shared coordinates, base-material color hints, and a build item referencing their component assembly.

For Bambu-compatible project import, the useful production-extension shape is:

- `3D/3dmodel.model` — assembly object with the production namespace and `p:path` component references.
- `3D/Objects/object_1.model` — mesh objects plus base-material display colors.
- `3D/_rels/3dmodel.model.rels` — relationship to the object model.
- `Metadata/model_settings.config` — part metadata and extruder assignment.

Assign extruder numbers by **unique normalized color**, not by part index. Several named parts can share one extruder. Part-index assignment makes a two-color assembly incorrectly request one filament per component.

Do not add partial printer or slicing metadata merely to carry colors. Omit `project_settings.config` and `slice_info.config` unless the exporter is intentionally creating a complete printer-specific sliced project. Partial presets can trigger unsafe or misleading slicer warnings.

## Verification gate

- Raised features overlap the backing; flush features have real cavities and finish at the surface.
- No component uses a negative-determinant transform.
- Welded meshes contain no degenerate triangles, open edges, or non-manifold edges.
- Component and assembly bounds match requested dimensions and extrusion depths.
- Repeated colors map to the same extruder.
- The archive opens in the target slicer with independently assignable parts.
- A neutral exported sample is sliced before relying on the exporter for production files.

The accompanying `example.gts` implements the finish distinction, cavity overtravel, positive-scale guard, welded mesh extraction, manifold checks, Z-bound assertions, and color-based extruder planning. It intentionally stops at a validated 3MF input plan; the XML/ZIP layer should consume only data that passed those gates.

**Source:** Anonymized extraction from a live Boxel fabrication tool; identifying source details intentionally omitted.

**See also:** `integrate-three-js-via-cdn` for WebGL lifecycle and cleanup, and `boxel/references/external-libraries.md` for pinned ESM imports.
