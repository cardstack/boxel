export function stripFileExtension(path: string): string {
  return path.replace(/\.[^/.]+$/, '');
}

// Used to generate a color for the profile avatar
// Copied from https://github.com/mui/material-ui/issues/12700
export function stringToColor(string: string | null) {
  if (!string) {
    return 'transparent';
  }

  let hash = 0;
  let i;

  for (i = 0; i < string.length; i += 1) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }

  let color = '#';

  for (i = 0; i < 3; i += 1) {
    const value = (hash >> (i * 8)) & 0xff;
    color += `00${value.toString(16)}`.substr(-2);
  }

  return color;
}

export function iconURLFor(word: string) {
  if (!word) {
    return undefined;
  }

  return iconURLs[word.toLocaleLowerCase().charAt(0)];
}

export function getRandomBackgroundURL() {
  const index = Math.floor(Math.random() * backgroundURLs.length);
  return backgroundURLs[index];
}

// TODO move the hosting to our S3
const iconURLs: { [letter: string]: string } = Object.freeze({
  a: 'https://i.postimg.cc/XvrXmQyJ/Letter-a.png',
  b: 'https://i.postimg.cc/mkyrCnKd/Letter-b.png',
  c: 'https://i.postimg.cc/g01rW8vK/Letter-c.png',
  d: 'https://i.postimg.cc/tCbZJ38S/Letter-d.png',
  e: 'https://i.postimg.cc/sf7G36HG/Letter-e.png',
  f: 'https://i.postimg.cc/SKPYxwpC/Letter-f.png',
  g: 'https://i.postimg.cc/Ssz22Dy5/Letter-g.png',
  h: 'https://i.postimg.cc/GhPDx7kn/Letter-h.png',
  i: 'https://i.postimg.cc/L6FffKgV/Letter-i.png',
  j: 'https://i.postimg.cc/x10zxvRJ/Letter-j.png',
  k: 'https://i.postimg.cc/vZ36p4qP/Letter-k.png',
  l: 'https://i.postimg.cc/rpw5m1RX/Letter-l.png',
  m: 'https://i.postimg.cc/qB3yzMqR/Letter-m.png',
  n: 'https://i.postimg.cc/26PW2gcr/Letter-n.png',
  o: 'https://i.postimg.cc/g2DvmSJH/Letter-o.png',
  p: 'https://i.postimg.cc/fyn3xmyb/Letter-p.png',
  q: 'https://i.postimg.cc/CK5fYw9w/Letter-q.png',
  r: 'https://i.postimg.cc/tJ3sDJnN/Letter-r.png',
  s: 'https://i.postimg.cc/jdhW7Wbs/Letter-s.png',
  t: 'https://i.postimg.cc/tTPJCJkG/Letter-t.png',
  u: 'https://i.postimg.cc/sxrXBzHQ/Letter-u.png',
  v: 'https://i.postimg.cc/5276sZyT/Letter-v.png',
  w: 'https://i.postimg.cc/vZH4LQY5/Letter-w.png',
  x: 'https://i.postimg.cc/85FWdTbZ/Letter-x.png',
  y: 'https://i.postimg.cc/KYpBg1tK/Letter-y.png',
  z: 'https://i.postimg.cc/rsxrbg3W/letter-z.png',
});
const backgroundURLs: readonly string[] = Object.freeze([
  'https://i.postimg.cc/WpyVYDN9/4k-atmosphere-curvature.jpg',
  'https://i.postimg.cc/k57PRKs5/4k-brushed-slabs.jpg',
  'https://i.postimg.cc/Sx6pKDW5/4k-crescent-lake.jpg',
  'https://i.postimg.cc/52dV1ZFL/4k-curvilinear-stairs.jpg',
  'https://i.postimg.cc/zXRrsJ3q/4k-desert-dunes.jpg',
  'https://i.postimg.cc/d0nP23Nj/4k-flowing-mesh.jpg',
  'https://i.postimg.cc/4dFD0MgK/4k-glass-reflection.jpg',
  'https://i.postimg.cc/G220qRZw/4k-glow-cells.jpg',
  'https://i.postimg.cc/mkzvWwLm/4k-green-wormhole.jpg',
  'https://i.postimg.cc/RCWh0xqD/4k-joshua-dawn.jpg',
  'https://i.postimg.cc/Y2T9GDWq/4k-leaves-moss.jpg',
  'https://i.postimg.cc/br7Kytdp/4k-light-streaks.jpg',
  'https://i.postimg.cc/SKQNFwwV/4k-metallic-leather.jpg',
  'https://i.postimg.cc/NjcjbyD3/4k-origami-flock.jpg',
  'https://i.postimg.cc/6pf5P91y/4k-paint-swirl.jpg',
  'https://i.postimg.cc/Lsy4HxSS/4k-pastel-triangles.jpg',
  'https://i.postimg.cc/gJnzr3cZ/4k-perforated-sheet.jpg',
  'https://i.postimg.cc/FR89S11n/4k-plastic-ripples.jpg',
  'https://i.postimg.cc/4ycXQZ94/4k-powder-puff.jpg',
  'https://i.postimg.cc/tRnRjdM0/4k-redrock-canyon.jpg',
  'https://i.postimg.cc/8P8pPF27/4k-rock-portal.jpg',
  'https://i.postimg.cc/13BsHvfF/4k-sand-stone.jpg',
  'https://i.postimg.cc/L6zHq9SN/4k-techno-floor.jpg',
  'https://i.postimg.cc/fbbZgY9r/4k-water-surface.jpg',
  'https://i.postimg.cc/qv4pyPM0/4k-watercolor-splashes.jpg',
  'https://i.postimg.cc/mr6Rxh32/4k-wildflower-field.jpg',
]);
