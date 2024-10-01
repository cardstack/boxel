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
  a: 'https://i.postimg.cc/BZwv0LyC/A.png',
  b: 'https://i.postimg.cc/rF0wFy22/B.png',
  c: 'https://i.postimg.cc/zXsXLmqb/C.png',
  d: 'https://i.postimg.cc/kgWMKj5j/D.png',
  e: 'https://i.postimg.cc/rpcVJS0q/E.png',
  f: 'https://i.postimg.cc/FKZ9n733/F.png',
  g: 'https://i.postimg.cc/502xcbSG/G.png',
  h: 'https://i.postimg.cc/fLqMDpHb/H.png',
  i: 'https://i.postimg.cc/SRXksd5f/I.png',
  j: 'https://i.postimg.cc/d3zvTdcP/J.png',
  k: 'https://i.postimg.cc/8k3T38JK/K.png',
  l: 'https://i.postimg.cc/pXFPM0K2/L.png',
  m: 'https://i.postimg.cc/JzCMrbQj/M.png',
  n: 'https://i.postimg.cc/4xvZmm8q/N.png',
  o: 'https://i.postimg.cc/g0YpRmQJ/O.png',
  p: 'https://i.postimg.cc/N0pckZvx/P.png',
  q: 'https://i.postimg.cc/gJjPS4Yb/Q.png',
  r: 'https://i.postimg.cc/4d0Rrtd7/R.png',
  s: 'https://i.postimg.cc/0jJ1xQMt/S.png',
  t: 'https://i.postimg.cc/Rq550Bwv/T.png',
  u: 'https://i.postimg.cc/7PC5bnSR/U.png',
  v: 'https://i.postimg.cc/xjWcmNR1/V.png',
  w: 'https://i.postimg.cc/kXKDvM1F/W.png',
  x: 'https://i.postimg.cc/13SXCxbx/X.png',
  y: 'https://i.postimg.cc/Qdqtv4rF/Y.png',
  z: 'https://i.postimg.cc/k5X4CQnf/Z.png',
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
