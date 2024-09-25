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
