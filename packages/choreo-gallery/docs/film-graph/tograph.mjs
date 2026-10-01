// Turn a film's BEATS table (as written in the .gts) into the proposed
// graph syntax: chapters as blocks, shots as named steps, joins as
// siblings, everything else attached. Values are carried verbatim.
import fs from 'node:fs';

const [, , file, name] = process.argv;
// the prefix the vocabulary is reached by: `f.` inside <Film as |f|>, `@f.` in a component that takes it as an argument
const F = process.env.PREFIX ?? 'f.';
const src = fs.readFileSync(file, 'utf8');

/* ---- a tiny tokenizer for the object literal ----------------------- */
function skipWs(s, i) {
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s.startsWith('/*', i)) { i = s.indexOf('*/', i) + 2; continue; }
    if (s.startsWith('//', i)) { i = s.indexOf('\n', i); continue; }
    return i;
  }
}
function readValue(s, i) {
  i = skipWs(s, i);
  const c = s[i];
  if (c === "'" || c === '"' || c === '`') {
    let j = i + 1;
    while (s[j] !== c) { if (s[j] === '\\') j++; j++; }
    return [s.slice(i, j + 1), j + 1];
  }
  if (c === '{' || c === '[' || c === '(') {
    const close = { '{': '}', '[': ']', '(': ')' }[c];
    let depth = 0, j = i;
    for (; j < s.length; j++) {
      const d = s[j];
      if (d === "'" || d === '"' || d === '`') { const [, k] = readValue(s, j); j = k - 1; continue; }
      if (s.startsWith('/*', j)) { j = s.indexOf('*/', j) + 1; continue; }
      if (d === c) depth++;
      else if (d === close) { depth--; if (depth === 0) break; }
    }
    return [s.slice(i, j + 1), j + 1];
  }
  let j = i;
  while (j < s.length && !/[,}\]\n]/.test(s[j])) {
    if (s[j] === '(') { const [, k] = readValue(s, j); j = k; continue; }
    j++;
  }
  return [s.slice(i, j).trim(), j];
}
function readObject(s) {
  // s is '{ ... }'
  const out = [];
  let i = skipWs(s, 1);
  while (i < s.length - 1) {
    i = skipWs(s, i);
    if (s[i] === '}') break;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(s.slice(i));
    if (!m) { i++; continue; }
    i += m[0].length;
    const [v, j] = readValue(s, i);
    out.push([m[1], v]);
    i = skipWs(s, j);
    if (s[i] === ',') i++;
  }
  return out;
}
function readArray(s) {
  const out = [];
  let i = skipWs(s, 1);
  while (i < s.length - 1) {
    i = skipWs(s, i);
    if (s[i] === ']') break;
    const [v, j] = readValue(s, i);
    out.push(v);
    i = skipWs(s, j);
    if (s[i] === ',') i++;
  }
  return out;
}

/* ---- TS value → Glimmer expression --------------------------------- */
function str(v) {
  const inner = v.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"');
  return `"${inner}"`;
}
function expr(v) {
  v = v.trim();
  if (/^['"`]/.test(v)) return str(v);
  if (v[0] === '{') return `(hash ${readObject(v).map(([k, x]) => `${k}=${expr(x)}`).join(' ')})`;
  if (v[0] === '[') return `(array ${readArray(v).map(expr).join(' ')})`;
  const call = /^([A-Za-z_][A-Za-z0-9_.]*)\((.*)\)$/s.exec(v);
  if (call) {
    const args = readArray('[' + call[2] + ']');
    return `(${call[1]} ${args.map(expr).join(' ')})`;
  }
  if (/^-?\d/.test(v) || v === 'true' || v === 'false' || v === 'null') return v;
  if (/^[A-Z][A-Z0-9_]*$/.test(v)) return v; // a constant
  if (/^-\s*[A-Z]/.test(v)) return `(neg ${v.slice(1).trim()})`;
  if (/[-+*/]/.test(v)) return `(calc "${v}")`; // arithmetic: honest about it
  return v;
}
function attr(k, v) { return `@${k}={{${expr(v)}}}`; }

/* ---- the grouping: which key goes where ----------------------------- */
// the shot's own facts; the head pose is flattened onto the shot, the
// tail pose is a <f.To> child, an eye-level walk is a <f.Eye> child
const SHOT = ['id', 'ticks', 'cut', 'lead', 'lift', 'bob', 'hold', 'follow', 'to', 'dissolve', 'quality'];
const TYPE = ['mode', 'kicker', 'kanji', 'romaji', 'gloss', 'says', 'bare'];
// ADJUSTMENTS: parameter sets the PICTURE declares, yielded as contextual
// components under f.picture — the package knows none of these names.
// Look is a FILTER (it processes the frame); the rest hold values.
const FILTERS = [
  [F + 'picture.Look', ['grade', 'look', 'lut']],
  [F + 'picture.Weather', ['theme', 'hours', 'hoursOver', 'haze', 'rain', 'wx', 'wxCut', 'lightning']],
  [F + 'picture.Winter', ['winter']],
  [F + 'picture.Sun', ['sun']],
  [F + 'picture.Light', ['rim']],
  [F + 'picture.Set', ['city', 'grass']],
  [F + 'picture.Build', ['build', 'buildBy', 'settle', 'style']],
];
const RENAME = { kanji: 'word', romaji: 'reading', build: 'clock', buildBy: 'by', style: 'subject', hoursOver: 'over' };
function pose(tag, v) {
  return `${tag} ${readObject(v).map(([k, x]) => attr(k, x)).join(' ')}`;
}

/* ---- walk the table ------------------------------------------------- */
const start = src.indexOf('const BEATS: Beat[] = [');
const body = readValue(src, start + 'const BEATS: Beat[] = '.length)[0];
// beats plus the banner comments between them
const items = [];
{
  let i = 1;
  while (i < body.length - 1) {
    const ws = skipWs(body, i);
    const gap = body.slice(i, ws);
    const banner = /\/\*\s*-+\s*\*\n\s*\*\s*(.+?)\n/.exec(gap);
    if (banner) items.push({ banner: banner[1].trim() });
    i = ws;
    if (body[i] === ']' || i >= body.length - 1) break;
    const [v, j] = readValue(body, i);
    items.push({ beat: readObject(v) });
    i = skipWs(body, j);
    if (body[i] === ',') i++;
  }
}

const chapters = JSON.parse(process.env.CHAPTERS);
const out = [];
const P = (s) => out.push(s);
let openCh = -1;
const ind = (n) => '  '.repeat(n);
let prevId = null;

for (const it of items) {
  if (it.banner) { P(''); P(`${ind(3)}{{! ${it.banner} }}`); continue; }
  const b = Object.fromEntries(it.beat);
  const ch = Number(b.ch);
  if (ch !== openCh) {
    if (openCh >= 0) P(`${ind(3)}</${F}Chapter>`);
    const c = chapters[ch];
    const tints = (c.tint ? ` @tint="${c.tint}"` : '') + (c.tintD ? ` @tintD="${c.tintD}"` : '');
    P(`${ind(3)}<${F}Chapter @n="${c.n}" @title="${c.title}"${c.grade ? ` @grade="${c.grade}"` : ''}${c.lut ? ` @lut="${c.lut}"` : ''}${tints}>`);
    openCh = ch;
  }
  const id = b.id.slice(1, -1);
  // the seam INTO this shot, as a sibling before it
  if (b.join) {
    const j = [`@presentation=${str(b.join)}`];
    if (b.dipTo) j.push(`@to=${str(b.dipTo)}`);
    P(`${ind(4)}<${F}Join ${j.join(' ')} />`);
  }
  const shotArgs = SHOT.filter((k) => k in b).map((k) => (k === 'id' ? `@name="${id}"` : attr(k, b[k])));
  const head = b.cam ? readObject(b.cam).map(([k, x]) => attr(k, x)) : [];
  P(`${ind(4)}<${F}Shot ${[...shotArgs, ...head].join(' ')}>`);
  if (b.toCam) P(`${ind(5)}<${pose(F + 'To', b.toCam)} />`);
  if (b.eye) { const e = Object.fromEntries(readObject(b.eye)); P(`${ind(5)}<${F}Eye @from={{${expr(e.at)}}}${e.to ? ` @to={{${expr(e.to)}}}` : ''} @fov={{${e.fov}}} />`); }
  const type = TYPE.filter((k) => k in b);
  if (type.length) P(`${ind(5)}<${F}Type ${type.map((k) => attr(RENAME[k] ?? k, b[k])).join(' ')} />`);
  if (b.vo) P(`${ind(5)}<${F}Voice @line=${str(b.vo)} @read={{get VO_SECS "${id}"}}${b.hush ? ' @hush={{true}}' : ''} />`);
  else if (b.hush) P(`${ind(5)}<${F}Voice @hush={{true}} />`);
  for (const [tag, keys] of FILTERS) {
    const have = keys.filter((k) => k in b);
    if (!have.length) continue;
    // an object-valued knob (sun: {az, el}; winter: {gust, pack}) is its own
    // filter with the object's keys as flat, typed arguments; null clears it
    if (have.length === 1 && (b[have[0]].startsWith('{') || b[have[0]] === 'null') && ['sun', 'winter'].includes(have[0])) {
      const v = b[have[0]];
      P(`${ind(5)}<${tag} ${v === 'null' ? '@off={{true}}' : readObject(v).map(([k, x]) => attr(k, x)).join(' ')} />`);
      continue;
    }
    P(`${ind(5)}<${tag} ${have.map((k) => attr(RENAME[k] ?? k, b[k])).join(' ')} />`);
  }
  if (b.mix) P(`${ind(5)}<${F}sound.Mix ${readObject(b.mix).map(([k, v]) => attr(k, v)).join(' ')} />`);
  if (b.stamp) { const s = Object.fromEntries(readObject(b.stamp)); P(`${ind(5)}<${F}Stamp @year={{${s.y}}}${s.at ? ` @at={{${s.at}}}` : ''} />`); }
  if (b.sky) P(`${ind(5)}<${F}Sky ${readObject(b.sky).map(([k, v]) => attr(k, v)).join(' ')} />`);
  if (b.mark) P(`${ind(5)}<${F}Mark ${readObject(b.mark).map(([k, v]) => attr(k, v)).join(' ')} />`);
  if (b.trace) for (const t of readArray(b.trace)) P(`${ind(5)}<${F}Trace ${readObject(t).map(([k, v]) => attr(k, v)).join(' ')} />`);
  if (b.cycle) P(`${ind(5)}<${F}Lineup @steps={{${expr(b.cycle)}}} />`);
  if (b.photo) {
    const p = Object.fromEntries(readObject(b.photo));
    P(`${ind(5)}<${F}Attach @lane={{1}}>`);
    P(`${ind(6)}<${F}Insert @src=${str(p.src)} @caption=${str(p.caption)} @credit=${str(p.credit)} />`);
    P(`${ind(5)}</${F}Attach>`);
  }
  if (b.clip) {
    const c = Object.fromEntries(readObject(b.clip));
    const win = [];
    if (c.at) win.push(`@at={{${c.at}}}`);
    if (c.for) win.push(`@for={{${c.for}}}`);
    if (c.end) win.push(`@end=${str(c.end)}`);
    const kind = c.kind ? c.kind.slice(1, -1) : 'video';
    const comp = { freeze: 'Freeze', image: 'Still', video: 'Video' }[kind];
    const rest = Object.entries(c).filter(([k]) => !['at', 'for', 'end', 'kind'].includes(k)).map(([k, v]) => attr(k, v));
    P(`${ind(5)}<${F}Attach @lane={{2}} ${win.join(' ')}>`);
    P(`${ind(6)}<${F}${comp} ${rest.join(' ')} />`);
    P(`${ind(5)}</${F}Attach>`);
  }
  P(`${ind(4)}</${F}Shot>`);
  prevId = id;
}
if (openCh >= 0) P(`${ind(3)}</${F}Chapter>`);
fs.writeFileSync(`/dev/stdout`, out.join('\n') + '\n');
