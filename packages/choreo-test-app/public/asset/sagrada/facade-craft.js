/* Photo-guided botanical relief, not a scan or surveyed reconstruction.
 * 1 model unit = 12.3 m. All detail is merged by campaign/material.
 * Separate from the film: no shot, clock, camera or audio changes.
 */
export function nativityCarving(Bk, c, X, Z) {
  const stone = Bk(c, 'carve'),
    detail = Bk(c, 'hi:carve');
  // Each leaf is a folded lobed surface, not a sprite. Its raised rib
  // catches the key light while its edges cast real contact shadows.
  function leaf(b, x, y, z, angle, length, width, curl = 0) {
    length *= 0.48;
    width *= 0.48;
    const cy = Math.cos(angle),
      sz = Math.sin(angle),
      N = 7;
    const point = (t, s) => {
      const lobe = 1 + 0.22 * Math.sin(t * Math.PI * 7);
      const w = width * Math.pow(Math.sin(t * Math.PI), 0.8) * lobe;
      return [
        x +
          length *
            (0.18 * Math.sin(t * Math.PI) * (1 - Math.abs(s)) +
              0.1 * t * t +
              curl * t),
        y + cy * t * length - sz * w * s,
        z + sz * t * length + cy * w * s,
      ];
    };
    for (let k = 0; k < N; k++) {
      for (const s of [-1, 1]) {
        const a = k / N,
          b0 = (k + 1) / N;
        b.face([point(a, 0), point(a, s), point(b0, s), point(b0, 0)]);
      }
    }
  }
  // Vine bands follow the three archivolts. The backing ribbons replace
  // the large exposed planar strips, while leaving entrances open.
  for (const [z0, w, h] of [
    [Z, 0.43, 2.85],
    [Z - 0.79, 0.33, 1.98],
    [Z + 0.79, 0.33, 1.98],
  ]) {
    for (let band = 0; band < 4; band++) {
      const W = w + band * 0.075,
        H = h + band * 0.14,
        points = [];
      for (let j = 0; j <= 40; j++) {
        const u = j / 40,
          z = z0 - W + 2 * W * u,
          y = 0.12 + H * (1 - (2 * u - 1) ** 2);
        points.push([X + 0.1 + band * 0.035 + 0.02 * Math.sin(u * 19), y, z]);
      }
      stone.tube(points, 0.035 + band * 0.006, 6, 1);
      for (let j = 2; j < 39; j++) {
        const p = points[j],
          a = points[j - 1],
          b = points[j + 1];
        const direction = Math.atan2(b[2] - a[2], b[1] - a[1]);
        for (const side of [-1, 1]) {
          leaf(
            detail,
            p[0] + 0.025,
            p[1],
            p[2],
            direction + side * (0.72 + (j % 3) * 0.12),
            0.105 + (j % 5) * 0.008,
            0.035
          );
        }
      }
    }
  }
  // Irregular foliate stalks connect archivolts to the central pediment.
  // These are explicitly a botanical interpretation, not biblical figures.
  for (const side of [-1, 1]) {
    for (let row = 0; row < 7; row++) {
      const y0 = 1.05 + row * 0.48,
        z0 = Z + side * (1.12 - row * 0.115),
        pts = [];
      for (let k = 0; k <= 12; k++) {
        const u = k / 12;
        pts.push([
          X + 0.1 + 0.07 * Math.sin(u * Math.PI),
          y0 + u * 0.55,
          z0 + side * 0.1 * Math.sin(u * 3),
        ]);
      }
      stone.tube(pts, (t) => 0.033 * (1 - 0.7 * t), 6, 1);
      for (let k = 1; k < 12; k++) {
        for (const s of [-1, 1]) {
          const p = pts[k];
          leaf(detail, p[0], p[1], p[2], s * 0.8, 0.1 + (k % 3) * 0.015, 0.035);
        }
      }
    }
  }
  // The Charity portal's palm columns have spiralling raised ribs.
  for (const side of [-1, 1]) {
    for (let strand = 0; strand < 5; strand++) {
      const pts = [];
      for (let j = 0; j <= 60; j++) {
        const t = j / 60,
          a = t * Math.PI * 3.2 + (strand * Math.PI * 2) / 5;
        pts.push([
          X + 0.1 + Math.cos(a) * 0.057,
          0.24 + t * 1.9,
          Z + side * 0.36 + Math.sin(a) * 0.057,
        ]);
      }
      detail.tube(pts, 0.008, 4, 1);
    }
  }
}

export function passionVaults(Bk, c, X, Z) {
  const b = Bk(c, 'stoneP');
  // Three real curved intrados surfaces bridge the portico to its back
  // wall. They intercept light and cast shadow; bump cannot do this.
  for (const [centre, width, peak] of [
    [0, 0.49, 2.8],
    [-0.9, 0.4, 2.23],
    [0.9, 0.4, 2.23],
  ]) {
    const point = (u, t) => {
      const z = centre + width * u;
      const arch = peak - 0.65 * (1 - Math.sqrt(Math.max(0, 1 - u * u)));
      return [X - 0.39 + t * 0.54, arch + 0.14 * Math.sin(t * Math.PI), Z + z];
    };
    b.cavity = 0.62;
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 6; j++) {
        const u = -1 + (2 * i) / 24,
          v = -1 + (2 * (i + 1)) / 24,
          t = j / 6,
          s = (j + 1) / 6;
        b.face([point(u, t), point(v, t), point(v, s), point(u, s)]);
      }
    }
    b.cavity = 1;
  }
  // Faceted sloping pedestals: groups stand on projecting ledges at
  // several heights, rather than float against one flat wall.
  for (const [z, y, w] of [
    [-0.93, 1.28, 0.52],
    [0.12, 1.28, 0.65],
    [0.99, 1.28, 0.43],
    [-0.4, 2.26, 0.29],
    [0.4, 2.26, 0.29],
  ]) {
    const A = [X - 0.21, y, Z + z - w / 2],
      B = [X - 0.21, y, Z + z + w / 2];
    b.face([
      A,
      B,
      [X + 0.1, y - 0.19, Z + z + w * 0.3],
      [X + 0.1, y - 0.19, Z + z - w * 0.3],
    ]);
    b.face([A, [X + 0.12, y, Z + z - w / 2], [X + 0.12, y, Z + z + w / 2], B]);
  }
}
