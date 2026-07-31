// Deterministic, prerender-safe silhouette. Returns an SVG path `d` string (no
// angle-bracket markup, so it is content-tag safe) describing the 12 edges of a
// box whose proportions match the model's bounding-box extents. The template
// draws it as real <svg>/<path> elements. Used by fitted, and as the
// loading/fallback placeholder behind the live viewer in embedded/isolated.
//
// Kept in a plain `.ts` module (no card-api dependency) so it can be imported
// by unit tests without pulling card-api into the host bundle.
export function silhouettePath(x = 1, y = 1, z = 1): string {
  let max = Math.max(x, y, z, 1e-6);
  let w = x / max;
  let h = y / max;
  let d = z / max;
  let ox = 120;
  let oy = 128;
  let s = 62;
  let project = (px: number, py: number, pz: number): [number, number] => {
    let ax = (px - 0.5) * w;
    let ay = (py - 0.5) * h;
    let az = (pz - 0.5) * d;
    return [ox + (ax - az) * s, oy + (ax + az) * (s / 2) - ay * s];
  };
  let corners: [number, number][] = [
    project(0, 0, 0),
    project(1, 0, 0),
    project(1, 0, 1),
    project(0, 0, 1),
    project(0, 1, 0),
    project(1, 1, 0),
    project(1, 1, 1),
    project(0, 1, 1),
  ];
  let edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  let fmt = (n: number): string => (Math.round(n * 100) / 100).toString();
  return edges
    .map(([a, b]) => {
      let from = corners[a];
      let to = corners[b];
      return `M${fmt(from[0])},${fmt(from[1])}L${fmt(to[0])},${fmt(to[1])}`;
    })
    .join(' ');
}
