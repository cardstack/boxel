/* Streamed botanical height field. Original procedural artwork, not a
 * photograph or a transcription of the façade's narrative sculptures.
 * A small recipe produces one shared 1024-square linear-data texture.
 */
export function reliefAtlas() {
  const S = 1024,
    canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.fillStyle = 'rgb(96,96,96)';
  g.fillRect(0, 0, S, S);
  const leaf = (x, y, a, L, W) => {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    const grad = g.createLinearGradient(-W, 0, W, 0);
    grad.addColorStop(0, '#646464');
    grad.addColorStop(0.48, '#dcdcdc');
    grad.addColorStop(0.55, '#bbbbbb');
    grad.addColorStop(1, '#686868');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(
      -W * 0.5,
      -L * 0.1,
      -W * 1.3,
      -L * 0.32,
      -W * 0.55,
      -L * 0.48
    );
    g.bezierCurveTo(-W * 1.05, -L * 0.65, -W * 0.12, -L * 0.76, 0, -L);
    g.bezierCurveTo(
      W * 0.12,
      -L * 0.76,
      W * 1.05,
      -L * 0.65,
      W * 0.55,
      -L * 0.48
    );
    g.bezierCurveTo(W * 1.3, -L * 0.32, W * 0.5, -L * 0.1, 0, 0);
    g.fill();
    g.strokeStyle = '#a8a8a8';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -L);
    g.stroke();
    g.restore();
  };
  // Nine non-identical branching fields, interrupted by the portal voids
  // in the actual geometry. No uniformly repeated brick/tile grid.
  for (let branch = 0; branch < 37; branch++) {
    const origin = 14 + branch * 27,
      phase = branch * 2.39996;
    for (let k = 0; k < 96; k++) {
      const y = S - 8 - k * 10.5 + Math.sin(phase) * 7;
      const x =
        origin + 14 * Math.sin(k * 0.32 + phase) + 9 * Math.sin(k * 0.67);
      for (const side of [-1, 1]) {
        leaf(
          x,
          y,
          side * (0.55 + 0.35 * Math.sin(k + phase)),
          6 + (k % 5),
          2 + (branch % 3) * 0.5
        );
      }
    }
  }
  // Flowers vary their petal count and orientation rather than repeating
  // one flat stamp. Height-only shading leaves illumination to the scene.
  for (let k = 0; k < 110; k++) {
    const x = 20 + ((k * 233) % 984),
      y = 20 + ((k * 379) % 984),
      n = 5 + (k % 3);
    for (let j = 0; j < n; j++) {
      leaf(x, y, (j * Math.PI * 2) / n + k * 0.7, 10 + (k % 7), 4);
    }
    const d = g.createRadialGradient(x, y, 0, x, y, 3);
    d.addColorStop(0, '#dedede');
    d.addColorStop(1, '#777777');
    g.fillStyle = d;
    g.beginPath();
    g.arc(x, y, 3, 0, Math.PI * 2);
    g.fill();
  }
  return canvas;
}
