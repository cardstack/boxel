/* eslint-disable -- generated vendored @cardstack/bxl runtime-bare; source commit eb9addc714e0111aa7bee5cf373a87cae11506e7. See README and NOTICE. */
var me = (e, t) => () => (e && (t = e((e = 0))), t);
var $t,
  Mt,
  R,
  D,
  Ot,
  Q = me(() => {
    'use strict';
    (($t = class extends Error {}),
      (Mt = class extends $t {}),
      (R = class extends $t {}),
      (D = class extends R {}),
      (Ot = class extends R {}));
  });
function Bt(e) {
  return new R(`'${e}' is not defined`);
}
function Ce(e) {
  return new Ot(`Feature '${e}' is not implemented`);
}
function Mn(e, t) {
  return new R(`Cannot index ${b(e)} with ${b(t)}`);
}
function Dt(e) {
  return new R(`Cannot slice ${b(e)}`);
}
var rt = me(() => {
  'use strict';
  Q();
  te();
});
function Ts(e, t) {
  return oi[e] - oi[t];
}
function M(e, t) {
  let n = b(e),
    r = Ts(n, b(t));
  if (r !== 0) return r;
  switch (n) {
    case 'null':
      return 0;
    case 'boolean':
    case 'number':
      return e - t;
    case 'string':
      for (let l = 0; l < Math.max(e.length, t.length); l++) {
        let c = e.codePointAt(l) ?? -1,
          d = t.codePointAt(l) ?? -1,
          p = c - d;
        if (p !== 0) return p;
      }
      return 0;
    case 'array':
      for (let l = 0; l < Math.max(e.length, t.length); l++) {
        if (e[l] === void 0) return -1;
        if (t[l] === void 0) return 1;
        let c = M(e[l], t[l]);
        if (c !== 0) return c;
      }
      return 0;
    case 'object':
      let i = Object.keys(e).sort(),
        o = Object.keys(t).sort(),
        s = M(i, o);
      if (s !== 0) return s;
      let a = i.map((l) => e[l]),
        u = o.map((l) => t[l]);
      return M(a, u);
  }
}
var oi,
  it = me(() => {
    'use strict';
    te();
    oi = { null: 0, boolean: 1, number: 2, string: 3, array: 4, object: 5 };
  });
function si(e, t) {
  return { start: e, end: t };
}
function H(e) {
  return (
    e &&
    (e.start === null || Number.isInteger(e.start)) &&
    (e.end === null || Number.isInteger(e.end))
  );
}
function E(e, t = []) {
  return { value: e, path: t };
}
function* ot(e) {
  for (let t of e) yield E(t);
}
function* Ye(e) {
  for (let t of e) yield t.value;
}
function* st(e) {
  for (let t of e) yield t.path;
}
function Ae(e) {
  return Array.from(Ye(e));
}
function b(e) {
  return Array.isArray(e) ? 'array' : e === null ? 'null' : typeof e;
}
function ai(e) {
  let t = b(e);
  return t !== 'array' && t !== 'object';
}
function Dn(e, t) {
  return b(e) === b(t);
}
function ee(e, t, n, r = n) {
  return b(e) === n && b(t) === r;
}
function ui(e, t, n, r) {
  return ee(e, t, n, r) || ee(e, t, r, n);
}
function qe(e, ...t) {
  return t.some((n) => b(e) === n);
}
function* O(e) {
  yield e;
}
function Pt(e) {
  return (
    Array.isArray(e) &&
    e.every((t) => {
      switch (typeof t) {
        case 'string':
          return !0;
        case 'number':
          return Number.isInteger(t);
        case 'object':
          return H(t);
        default:
          return !1;
      }
    })
  );
}
function li(e) {
  return Array.isArray(e) && e.every((t) => Pt(t));
}
function q(e) {
  return e !== null && e !== !1;
}
function ci(e, t) {
  if (t <= 0) return null;
  let n = '';
  for (let r = 0; r < Math.floor(t); r++) n += e;
  return n;
}
function* Lt(e) {
  if ((yield e, b(e) === 'object'))
    for (let t of Object.values(e)) yield* Lt(t);
  else if (b(e) === 'array') for (let t of e) yield* Lt(t);
}
function G(e) {
  switch (b(e)) {
    case 'null':
      return 'null';
    case 'boolean':
    case 'number':
      return e.toString();
    case 'string':
      return e;
    case 'array':
    case 'object':
      return JSON.stringify(e);
  }
}
function Ln(e, t) {
  let n = [];
  for (let r = 0; r < e.length; r++)
    for (let i = 0; i < t.length && M(e[r + i], t[i]) === 0; i++)
      i + 1 === t.length && n.push(r);
  return n;
}
function W(e, t) {
  if (ee(t, e, 'number', 'array')) return e[On(e.length, t)] ?? null;
  if (ee(t, e, 'string', 'object')) return e[t] ?? null;
  if (ee(t, e, 'array', 'array')) return Ln(e, t);
  if (b(e) === 'null' && (qe(t, 'number', 'string') || H(t))) return null;
  if (qe(e, 'array', 'string') && H(t))
    return e.slice(t.start ?? void 0, t.end ?? void 0);
  throw H(t) ? Dt(e) : Mn(e, t);
}
function On(e, t) {
  return t < 0 ? e + t : t;
}
function Bn(e, t) {
  let { start: n, end: r } = t,
    i = Math.max(0, Math.min(On(e, r ?? e), e));
  return { start: Math.max(0, Math.min(On(e, n ?? 0), i)), end: i };
}
function at(e, t) {
  if (!H(t[0])) return t;
  let n = 1,
    r = Bn(e, t[0]);
  for (; H(t[n]); ) {
    e = r.end - r.start;
    let i = Bn(e, t[n]);
    ((r = { start: r.start + i.start, end: r.start + i.end }), n++);
  }
  if (n < t.length) {
    let i = t[n];
    if (typeof i != 'number') throw Mn([], i);
    return [r.start + i, ...t.slice(n + 1)];
  } else return [r];
}
function Ns(e) {
  let t = [];
  for (let n = e.start; n < e.end; n++) t.push(n);
  return t;
}
function Es(e, t) {
  return typeof e == 'string' || typeof e == 'number'
    ? e === t
    : H(e) && H(t) && e.start === t.start && e.end === t.end;
}
function ks(e, t) {
  return t.length <= e.length && t.every((n, r) => Es(e[r], n));
}
function ut(e, t) {
  return ks(e, t) ? e.slice(t.length) : e;
}
function Pn(e, t) {
  if (ee(e, t, 'object', 'object')) {
    let n = new Set(Object.keys(e).concat(Object.keys(t))),
      r = [];
    for (let i of n) r.push([i, Pn(e[i], t[i])]);
    return Object.fromEntries(r);
  } else return t === void 0 ? e : t;
}
function we(e) {
  switch (b(e)) {
    case 'null':
    case 'boolean':
    case 'number':
    case 'string':
      return e;
    case 'array':
      return e.map(we);
    case 'object':
      return Object.fromEntries(Object.entries(e).map(([t, n]) => [t, we(n)]));
  }
}
function Fn(e) {
  switch (b(e)) {
    case 'null':
    case 'boolean':
    case 'number':
    case 'string':
      return e;
    case 'array':
      return [...e];
    case 'object':
      return { ...e };
  }
}
function _s(e) {
  let t = {};
  for (let n of e.filter((r) => r.length > 1)) {
    let r = n[0];
    if (H(r))
      throw new R(
        'getChildPaths: Cannot handle paths that are longer than 1, and start in a slice accessor',
      );
    (r in t || (t[r] = []), t[r].push(n.slice(1)));
  }
  return t;
}
function Un(e, t) {
  if (t.length === 0) return e;
  let n = b(e);
  if (qe(e, 'array', 'object')) {
    let r = Fn(e),
      i = t.map((o) => at(b(e) === 'array' ? e.length : 0, o));
    for (let o of i) {
      if (o.length !== 1) continue;
      let s = o[0];
      if ((W(r, s), H(s))) {
        let a = Bn(e.length, s);
        for (let u of Ns(a)) delete r[u];
      } else delete r[s];
    }
    n === 'array' && (r = r.filter((o) => o !== void 0));
    for (let [o, s] of Object.entries(_s(i))) o in r && (r[o] = Un(r[o], s));
    return r;
  } else throw new R(`Cannot delete fields from ${n}`);
}
function* zn(e, t, n) {
  let r, i, o;
  t !== void 0 && n !== void 0
    ? ((r = I(e)), (i = I(t)), (o = I(n)))
    : t !== void 0
      ? ((r = I(e)), (i = I(t)), (o = 1))
      : ((r = 0), (i = I(e)), (o = 1));
  for (let s = r; s < i; s += o) yield s;
}
function I(e) {
  if (e == null) return 0;
  if (b(e) !== 'number') throw new R(`Got ${b(e)}, number expected`);
  return e;
}
function J(e) {
  if (e == null) return '';
  if (b(e) !== 'string') throw new R(`Got ${b(e)}, string expected`);
  return e;
}
function jn(e) {
  if (!qe(e, 'array', 'object')) throw new R(`${b(e)} has no keys`);
  return b(e) === 'array' ? Array.from(zn(e.length)) : Object.keys(e);
}
function pi(e, t) {
  if (!ee(e, t, 'array', 'number') && !ee(e, t, 'object', 'string'))
    throw new R(`Cannot check whether ${b(e)} has a ${b(t)} key`);
  return t in e;
}
function di(e) {
  return e.sort(M);
}
function Vn(e) {
  let t = e.indices;
  if (e.index === void 0 || t === void 0)
    throw new R('RegExp match item transformation error');
  return {
    offset: e.index,
    length: e[0].length,
    string: e[0],
    captures: e.slice(1).map((r, i) => ({
      offset: t[i + 1][0],
      length: r.length,
      string: r,
      name: null,
    })),
  };
}
var te = me(() => {
  'use strict';
  Q();
  rt();
  it();
});
function Vt(e) {
  return e.bareNativeFilter;
}
function Re(e) {
  return Object.fromEntries(
    Object.entries(e).map(([t, n]) => {
      let r = (i, ...o) => ot(n(i.value, ...Ae(o)));
      return ((r.bareNativeFilter = n), [t, r]);
    }),
  );
}
function Ni(e) {
  return typeof e == 'function';
}
var De = me(() => {
  'use strict';
  te();
});
function y(e) {
  throw new lr(e);
}
var lr,
  h,
  pd,
  Jt = me(() => {
    'use strict';
    ((lr = class extends Error {
      constructor(n) {
        super(n);
        this.code = n;
        this.name = 'ExcelError';
      }
    }),
      (h = {
        nil: '#NULL!',
        div0: '#DIV/0!',
        value: '#VALUE!',
        ref: '#REF!',
        name: '#NAME?',
        num: '#NUM!',
        na: '#N/A',
        error: '#ERROR!',
        data: '#GETTING_DATA',
      }),
      (pd = {
        [h.nil]: 1,
        [h.div0]: 2,
        [h.value]: 3,
        [h.ref]: 4,
        [h.name]: 5,
        [h.num]: 6,
        [h.na]: 7,
        [h.data]: 8,
        [h.error]: 9,
      }));
  });
function ga(e) {
  return e != null;
}
function yt(e) {
  return e == null || e === '';
}
function N(e) {
  if (!Array.isArray(e)) return [e];
  let t = [];
  for (let n of e) t.push(...N(n));
  return t;
}
function f(e) {
  if (e == null) return 0;
  if (typeof e == 'boolean') return e ? 1 : 0;
  if (typeof e == 'number' && !Number.isNaN(e)) return e;
  if (typeof e == 'string' && e !== '' && !Number.isNaN(Number(e)))
    return parseFloat(e);
  y(h.value);
}
function k(e) {
  return e == null
    ? ''
    : typeof e == 'string'
      ? e
      : typeof e == 'boolean'
        ? e
          ? 'TRUE'
          : 'FALSE'
        : String(e);
}
function Zt(e) {
  if (typeof e == 'boolean') return e;
  if (typeof e == 'number') return e !== 0;
  if (typeof e == 'string') {
    let t = e.toUpperCase();
    if (t === 'TRUE') return !0;
    if (t === 'FALSE') return !1;
  }
  y(h.value);
}
function ye(e) {
  let t = N(e);
  return (t.length === 0 && y(h.value), t.map((n) => f(n)));
}
function gt(e) {
  let t = 0;
  for (let n of N(e)) {
    if (typeof n == 'number') {
      t += n;
      continue;
    }
    if (typeof n == 'string') {
      let r = parseFloat(n);
      Number.isNaN(r) || (t += r);
      continue;
    }
    Array.isArray(n) && (t += gt(n));
  }
  return t;
}
function Qi(e) {
  return N(e).filter((t) => typeof t == 'number' && Number.isFinite(t)).length;
}
function eo(e) {
  return N(e).filter((t) => t != null && t !== '').length;
}
function cr(e) {
  let t = N(e).filter(ga);
  t.length === 0 && y(h.div0);
  let n = t.filter((r) => typeof r == 'number' && Number.isFinite(r));
  return (n.length === 0 && y(h.num), n.reduce((r, i) => r + i, 0) / n.length);
}
function to(e) {
  let t = ye(e);
  return Math.min(...t);
}
function no(e) {
  let t = ye(e);
  return Math.max(...t);
}
function pr(e) {
  let t = ye(e);
  t.length < 2 && y(h.div0);
  let n = t.reduce((i, o) => i + o, 0) / t.length,
    r = t.reduce((i, o) => i + (o - n) ** 2, 0) / (t.length - 1);
  return Math.sqrt(r);
}
function ro(e) {
  let t = ye(e);
  t.length === 0 && y(h.div0);
  let n = t.reduce((i, o) => i + o, 0) / t.length,
    r = t.reduce((i, o) => i + (o - n) ** 2, 0) / t.length;
  return Math.sqrt(r);
}
var bt = me(() => {
  'use strict';
  Jt();
});
function se(e, t, n, r = 0, i = 0, o = 0) {
  return new Date(Date.UTC(e, t, n, r, i, o));
}
function va(e) {
  Number.isFinite(e) || y(h.num);
  let t = e;
  t < 60 && (t += 1);
  let r = Math.floor(t - 25569) * 86400,
    i = new Date(r * 1e3),
    o = t - Math.floor(t) + 1e-7,
    s = Math.floor(86400 * o),
    a = s % 60;
  s -= a;
  let u = Math.floor(s / 3600),
    l = Math.floor(s / 60) % 60,
    c = i.getUTCDate(),
    d = i.getUTCMonth();
  return (
    e >= 60 && e < 61 && ((c = 29), (d = 1)),
    se(i.getUTCFullYear(), d, c, u, l, a)
  );
}
function ge(e) {
  let t = se(1900, 0, 1).getTime(),
    n = e.getTime() > Date.UTC(1900, 1, 28) ? 2 : 1;
  return Math.ceil((e.getTime() - t) / Qt) + n;
}
function V(e) {
  if (e instanceof Date && !Number.isNaN(e.getTime()))
    return new Date(e.getTime());
  if (typeof e == 'number') return ((e < 0 || e >= 2958466) && y(h.num), va(e));
  if (typeof e == 'string') {
    let t = Number(e);
    if (e.trim() !== '' && Number.isFinite(t)) return V(t);
    let n = /^\d{4}-\d\d?-\d\d?$/.test(e)
      ? new Date(`${e}T00:00:00.000Z`)
      : new Date(e);
    if (!Number.isNaN(n.getTime())) return n;
  }
  y(h.value);
}
function Ra(e) {
  return (Array.isArray(e) ? e : [e]).map((n) => V(n));
}
function so(e, t, n) {
  let r = Math.trunc(e),
    i = Math.trunc(t),
    o = Math.trunc(n);
  return ge(se(r, i - 1, o));
}
function ao(e) {
  return V(e).getUTCFullYear();
}
function uo(e) {
  return V(e).getUTCMonth() + 1;
}
function lo(e) {
  return V(e).getUTCDate();
}
function Pe(e, t) {
  return Math.ceil((t.getTime() - e.getTime()) / Qt);
}
function fr(e) {
  return new Date(Date.UTC(e, 1, 29)).getUTCMonth() === 1;
}
function mr(e, t, n = 0) {
  let r = V(e),
    i = V(t),
    o = Math.trunc(Number(n) || 0),
    s = r.getUTCDate(),
    a = r.getUTCMonth() + 1,
    u = r.getUTCFullYear(),
    l = i.getUTCDate(),
    c = i.getUTCMonth() + 1,
    d = i.getUTCFullYear();
  switch (o) {
    case 0:
      return (
        s === 31 && l === 31
          ? ((s = 30), (l = 30))
          : s === 31
            ? (s = 30)
            : s === 30 && l === 31 && (l = 30),
        (l + c * 30 + d * 360 - (s + a * 30 + u * 360)) / 360
      );
    case 1: {
      let p = (m, T) => {
          let $ = m.getUTCFullYear(),
            F = se($, 2, 1);
          if (fr($) && m < F && T >= F) return !0;
          let U = T.getUTCFullYear(),
            Z = se(U, 2, 1);
          return fr(U) && T >= Z && m < Z;
        },
        g = 365;
      if (u === d || (u + 1 === d && (a > c || (a === c && s >= l))))
        return (
          ((u === d && fr(u)) || p(r, i) || (c === 1 && l === 29)) && (g = 366),
          Pe(r, i) / g
        );
      let x = d - u + 1,
        S = (se(d + 1, 0, 1).getTime() - se(u, 0, 1).getTime()) / Qt / x;
      return Pe(r, i) / S;
    }
    case 2:
      return Pe(r, i) / 360;
    case 3:
      return Pe(r, i) / 365;
    case 4:
      return (l + c * 30 + d * 360 - (s + a * 30 + u * 360)) / 360;
    default:
      y(h.num);
  }
}
function co(e, t, n) {
  let r = V(e),
    i = V(t),
    o = String(n).toUpperCase();
  i < r && y(h.num);
  let s = r.getUTCFullYear(),
    a = r.getUTCMonth(),
    u = r.getUTCDate(),
    l = i.getUTCFullYear(),
    c = i.getUTCMonth(),
    d = i.getUTCDate();
  switch (o) {
    case 'Y': {
      let p = l - s;
      return ((c < a || (c === a && d < u)) && p--, p);
    }
    case 'M': {
      let p = (l - s) * 12 + (c - a);
      return (d < u && p--, p);
    }
    case 'D':
      return Pe(r, i);
    case 'MD':
      return d >= u ? d - u : new Date(Date.UTC(l, c, 0)).getUTCDate() - u + d;
    case 'YM': {
      let p = c - a;
      return (d < u && p--, p < 0 ? p + 12 : p);
    }
    case 'YD': {
      let p = se(l, a, u);
      if (p <= i) return Pe(p, i);
      let g = se(l - 1, a, u);
      return Pe(g, i);
    }
    default:
      y(h.num);
  }
}
function po(e) {
  let t = String(e),
    n = V(t);
  return ge(se(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}
function hr(e, t, n = !1) {
  let r = V(e),
    i = V(t),
    o = !!n,
    s = r.getUTCDate(),
    a = r.getUTCMonth() + 1,
    u = r.getUTCFullYear(),
    l = i.getUTCDate(),
    c = i.getUTCMonth() + 1,
    d = i.getUTCFullYear();
  return (
    o
      ? (s === 31 && (s = 30), l === 31 && (l = 30))
      : (s === 31 && (s = 30), l === 31 && s >= 30 && (l = 30)),
    (d - u) * 360 + (c - a) * 30 + (l - s)
  );
}
function yr(e, t = 1) {
  let n = V(e),
    r = Math.floor(Number(t) || 1),
    i = se(n.getUTCFullYear(), 0, 1),
    o = Math.floor((n.getTime() - i.getTime()) / Qt),
    s = i.getUTCDay(),
    a = r === 2 ? (s === 0 ? 6 : s - 1) : s;
  return Math.floor((o + a) / 7) + 1;
}
function fo(e) {
  let t = e.getUTCDay();
  return t === 0 || t === 6;
}
function mo(e = 1) {
  if (typeof e == 'string') {
    (!/^[01]{7}$/.test(e) || e === '1111111') && y(h.value);
    let r = [1, 2, 3, 4, 5, 6, 0];
    return new Set(e.split('').flatMap((i, o) => (i === '1' ? [r[o]] : [])));
  }
  let t = Math.trunc(f(e)),
    n = Ia[t];
  return (n || y(h.value), new Set(n));
}
function en(e) {
  let t = new Set();
  if (e === void 0) return t;
  for (let n of Ra(e)) t.add(ge(n));
  return t;
}
function ho(e, t) {
  return t.has(e.getUTCDay());
}
function gr(e, t, n) {
  let r = V(e),
    i = V(t),
    o = en(n),
    s = i >= r ? 1 : -1,
    a = s === 1 ? r : i,
    u = s === 1 ? i : r,
    l = 0,
    c = new Date(a.getTime());
  for (; c <= u; )
    (!fo(c) && !o.has(ge(c)) && l++, c.setUTCDate(c.getUTCDate() + 1));
  return s * l;
}
function br(e, t, n) {
  let r = V(e),
    i = Math.trunc(f(t)),
    o = en(n),
    s = i >= 0 ? 1 : -1;
  i = Math.abs(i);
  let a = new Date(r.getTime()),
    u = 0;
  for (; u < i; )
    (a.setUTCDate(a.getUTCDate() + s), !fo(a) && !o.has(ge(a)) && u++);
  return ge(a);
}
function tn(e, t, n = 1, r) {
  let i = V(e),
    o = V(t),
    s = mo(n),
    a = en(r),
    u = o >= i ? 1 : -1,
    l = u === 1 ? i : o,
    c = u === 1 ? o : i,
    d = 0,
    p = new Date(l.getTime());
  for (; p <= c; )
    (!ho(p, s) && !a.has(ge(p)) && d++, p.setUTCDate(p.getUTCDate() + 1));
  return u * d;
}
function nn(e, t, n = 1, r) {
  let i = V(e),
    o = Math.trunc(f(t)),
    s = mo(n),
    a = en(r),
    u = o >= 0 ? 1 : -1;
  o = Math.abs(o);
  let l = new Date(i.getTime()),
    c = 0;
  for (; c < o; )
    (l.setUTCDate(l.getUTCDate() + u), !ho(l, s) && !a.has(ge(l)) && c++);
  return ge(l);
}
var Qt,
  Ia,
  yo = me(() => {
    'use strict';
    bt();
    Jt();
    ((Qt = 24 * 60 * 60 * 1e3),
      (Ia = {
        1: [0, 6],
        2: [0, 1],
        3: [1, 2],
        4: [2, 3],
        5: [3, 4],
        6: [4, 5],
        7: [5, 6],
        11: [0],
        12: [1],
        13: [2],
        14: [3],
        15: [4],
        16: [5],
        17: [6],
      }));
  });
function Za(e) {
  return Ja.get(e.toLowerCase());
}
function ko(e, t) {
  let n = Za(e);
  if (n && !(t !== void 0 && !n.arities.includes(t))) return n.name;
}
var wt,
  Md,
  No,
  Eo,
  Ka,
  Ja,
  cn = me(() => {
    'use strict';
    ((wt = [
      { name: 'contains', arities: [2, 3] },
      { name: 'equals', arities: [2] },
      { name: 'isAbaRouting', arities: [1] },
      { name: 'isAfter', arities: [1, 2], volatile: !0 },
      { name: 'isAlpha', arities: [1, 2, 3] },
      { name: 'isAlphanumeric', arities: [1, 2, 3] },
      { name: 'isAscii', arities: [1] },
      { name: 'isBase32', arities: [1, 2] },
      { name: 'isBase58', arities: [1] },
      { name: 'isBase64', arities: [1, 2] },
      { name: 'isBefore', arities: [1, 2], volatile: !0 },
      { name: 'isBIC', arities: [1] },
      { name: 'isBoolean', arities: [1, 2] },
      { name: 'isBtcAddress', arities: [1] },
      { name: 'isByteLength', arities: [1, 2] },
      { name: 'isCreditCard', arities: [1, 2] },
      { name: 'isCurrency', arities: [1, 2] },
      { name: 'isDataURI', arities: [1] },
      { name: 'isDate', arities: [1, 2] },
      { name: 'isDecimal', arities: [1, 2] },
      { name: 'isDivisibleBy', arities: [2] },
      { name: 'isEAN', arities: [1] },
      { name: 'isEmail', arities: [1, 2] },
      { name: 'isEmpty', arities: [1, 2] },
      { name: 'isEthereumAddress', arities: [1] },
      { name: 'isFloat', arities: [1, 2] },
      { name: 'isFQDN', arities: [1, 2] },
      { name: 'isFreightContainerID', arities: [1] },
      { name: 'isFullWidth', arities: [1] },
      { name: 'isHalfWidth', arities: [1] },
      { name: 'isHash', arities: [2] },
      { name: 'isHexadecimal', arities: [1] },
      { name: 'isHexColor', arities: [1, 2] },
      { name: 'isHSL', arities: [1] },
      { name: 'isIBAN', arities: [1, 2] },
      { name: 'isIdentityCard', arities: [2] },
      { name: 'isIMEI', arities: [1, 2] },
      { name: 'isIn', arities: [2] },
      { name: 'isInt', arities: [1, 2] },
      { name: 'isIP', arities: [1, 2] },
      { name: 'isIPRange', arities: [1, 2] },
      { name: 'isISBN', arities: [1, 2] },
      { name: 'isISIN', arities: [1] },
      { name: 'isISO15924', arities: [1] },
      { name: 'isISO31661Alpha2', arities: [1, 2] },
      { name: 'isISO31661Alpha3', arities: [1, 2] },
      { name: 'isISO31661Numeric', arities: [1] },
      { name: 'isISO4217', arities: [1] },
      { name: 'isISO6346', arities: [1] },
      { name: 'isISO6391', arities: [1] },
      { name: 'isISO8601', arities: [1, 2] },
      { name: 'isISRC', arities: [1] },
      { name: 'isISSN', arities: [1, 2] },
      { name: 'isJSON', arities: [1, 2] },
      { name: 'isJWT', arities: [1] },
      { name: 'isLatLong', arities: [1, 2] },
      { name: 'isLength', arities: [1, 2] },
      { name: 'isLicensePlate', arities: [2] },
      { name: 'isLocale', arities: [1] },
      { name: 'isLowercase', arities: [1] },
      { name: 'isLuhnNumber', arities: [1] },
      { name: 'isMACAddress', arities: [1, 2] },
      { name: 'isMagnetURI', arities: [1] },
      { name: 'isMailtoURI', arities: [1, 2] },
      { name: 'isMD5', arities: [1] },
      { name: 'isMimeType', arities: [1] },
      { name: 'isMobilePhone', arities: [1, 2, 3] },
      { name: 'isMongoId', arities: [1] },
      { name: 'isMultibyte', arities: [1] },
      { name: 'isNumeric', arities: [1, 2] },
      { name: 'isOctal', arities: [1] },
      { name: 'isPassportNumber', arities: [2] },
      { name: 'isPort', arities: [1] },
      { name: 'isPostalCode', arities: [2] },
      { name: 'isRFC3339', arities: [1] },
      { name: 'isRgbColor', arities: [1, 2] },
      { name: 'isSemVer', arities: [1] },
      { name: 'isSlug', arities: [1] },
      { name: 'isStrongPassword', arities: [1, 2] },
      { name: 'isSurrogatePair', arities: [1] },
      { name: 'isTaxID', arities: [1, 2] },
      { name: 'isTime', arities: [1, 2] },
      { name: 'isULID', arities: [1] },
      { name: 'isURL', arities: [1, 2] },
      { name: 'isUUID', arities: [1, 2] },
      { name: 'isUppercase', arities: [1] },
      { name: 'isVAT', arities: [2] },
      { name: 'isVariableWidth', arities: [1] },
      { name: 'isWhitelisted', arities: [2] },
      { name: 'matches', arities: [2, 3] },
    ]),
      (Md = wt.map((e) => e.name)),
      (No = wt
        .filter((e) => !('volatile' in e && e.volatile))
        .map((e) => e.name)),
      (Eo = wt.filter((e) => 'volatile' in e && e.volatile).map((e) => e.name)),
      (Ka = new Set(wt.flatMap((e) => e.arities.map((t) => `${e.name}/${t}`)))),
      (Ja = new Map(wt.map((e) => [e.name.toLowerCase(), e]))));
  });
Q();
var Xe = class {
  constructor(t) {
    this.input = t;
  }
  state = { pos: 0, line: 1, col: 0, lineStart: 0 };
  prev = { pos: 0, line: 1, col: 0, lineStart: 0 };
  next() {
    let t = this.input.charAt(this.state.pos++);
    return (
      t ==
      `
`
        ? (this.state.line++,
          (this.state.col = 0),
          (this.state.lineStart = this.state.pos))
        : this.state.col++,
      t
    );
  }
  peek(t = 0) {
    return this.input.charAt(this.state.pos + t);
  }
  eof() {
    return this.peek() == '';
  }
  croak(t) {
    return new Mt(`${t} (${this.state.line}:${this.state.col})

${this.getLine()}
${this.getErrorPointer()}`);
  }
  snapshot() {
    this.prev = { ...this.state };
  }
  restore() {
    this.state = { ...this.prev };
  }
  getLine() {
    let t = 0;
    for (
      ;
      ![
        `
`,
        '',
      ].includes(this.input.charAt(this.state.pos + t));
    )
      t++;
    return this.input.substring(this.state.lineStart, this.state.pos + t);
  }
  getErrorPointer() {
    let t = '';
    for (let n = 0; n < this.state.col; n++) t += '-';
    return ((t += '^'), t);
  }
};
var pe = class e {
  constructor(t, n = !1) {
    this.input = t;
    this.recordConsumedTokens = n;
  }
  current = null;
  consumed = [];
  lastErrorPhase = 'parse';
  static tokenTypeToString = {
    punc: 'punctuation',
    op: 'operator',
    ident: 'identifier',
    kw: 'keyword',
    format: 'format',
    var: 'variable',
    str: 'string',
    null: 'null',
    bool: 'boolean',
    num: 'number',
  };
  static escapeCharacters = {
    b: '\b',
    f: '\f',
    n: `
`,
    r: '\r',
    t: '	',
    v: '\v',
    "'": "'",
    '"': '"',
    '\\': '\\',
  };
  static keywords = new Set([
    '__loc__',
    'and',
    'as',
    'break',
    'catch',
    'def',
    'elif',
    'else',
    'end',
    'foreach',
    'if',
    'import',
    'include',
    'label',
    'module',
    'modulemeta',
    'not',
    'or',
    'reduce',
    'then',
    'try',
  ]);
  static operators = new Set([
    '!=',
    '%',
    '%=',
    '*',
    '*=',
    '+',
    '+=',
    ',',
    '-',
    '-=',
    '.',
    '..',
    '/',
    '//',
    '//=',
    '/=',
    '<',
    '<=',
    '=',
    '==',
    '>',
    '>=',
    '?',
    '?//',
    '|',
    '|=',
  ]);
  interpolationContexts = [];
  next() {
    let t = this.current;
    this.current = null;
    let n = t || this.readNext();
    return (n && this.recordConsumedTokens && this.consumed.push(n), n);
  }
  peek() {
    return this.current || (this.current = this.readNext());
  }
  eof() {
    return this.peek() === null;
  }
  croak(t, n = 'parse') {
    return (
      (this.lastErrorPhase = n),
      this.input.restore(),
      this.input.croak(t)
    );
  }
  consumedTokens() {
    return this.consumed.slice();
  }
  toArray() {
    let t = [];
    for (; !this.eof(); ) t.push(this.next());
    return t;
  }
  readNext() {
    if (this.interpolationContextJustExited())
      return (
        this.input.snapshot(),
        this.interpolationContexts.pop(),
        this.readString()
      );
    if (
      (this.readWhile(e.isWhitespace), this.input.snapshot(), this.input.eof())
    )
      return null;
    let t = this.input.peek();
    if (t === '#') return (this.skipComment(), this.readNext());
    if (e.isDigit(t)) return this.readNumber();
    if (t == '"') return (this.input.next(), this.readString());
    if (e.isIdentStart(t)) return this.readIdent();
    if (e.isPuncChar(t)) return this.readPunc();
    if (e.isOpChar(t)) return this.readOp();
    throw this.croak(`Can't handle character: ${t}`, 'tokenize');
  }
  readWhile(t) {
    let n = '';
    for (; !this.input.eof() && t(this.input.peek()); ) n += this.input.next();
    return n;
  }
  skipComment() {
    this.readWhile(
      (t) =>
        t !==
        `
`,
    );
  }
  readIdent() {
    let t = this.readWhile(e.isIdentChar);
    return t === 'null'
      ? { type: 'null', value: null }
      : t === 'true'
        ? { type: 'bool', value: !0 }
        : t === 'false'
          ? { type: 'bool', value: !1 }
          : {
              type: e.keywords.has(t)
                ? 'kw'
                : t.charAt(0) === '@'
                  ? 'format'
                  : t.charAt(0) === '$'
                    ? 'var'
                    : 'ident',
              value: t,
            };
  }
  interpolationContextJustExited() {
    return (
      this.interpolationContexts[this.interpolationContexts.length - 1] === 0
    );
  }
  updateInterpolationContext(t) {
    let n = this.interpolationContexts.length;
    n !== 0 &&
      (t === '('
        ? this.interpolationContexts[n - 1]++
        : t === ')' && this.interpolationContexts[n - 1]--);
  }
  readPunc() {
    let t = this.input.next();
    if (t == '\\') {
      if (this.input.peek() !== '(')
        throw this.croak(
          `Can't handle character: ${this.input.peek()}`,
          'tokenize',
        );
      ((t += this.input.next()), this.interpolationContexts.push(1));
    } else this.updateInterpolationContext(t);
    return { type: 'punc', value: t };
  }
  readOp() {
    let t = this.input.next();
    return (
      e.operators.has(t + this.input.peek() + this.input.peek(1))
        ? (t += this.input.next() + this.input.next())
        : e.operators.has(t + this.input.peek()) && (t += this.input.next()),
      { type: 'op', value: t }
    );
  }
  readString() {
    let t = !1,
      n = '';
    for (
      ;
      !this.input.eof() &&
      !(this.input.peek() == '\\' && this.input.peek(1) === '(');
    ) {
      let r = this.input.next();
      if (t) ((n += this.getEscaped(r)), (t = !1));
      else if (r == '\\') t = !0;
      else {
        if (r == '"') break;
        n += r;
      }
    }
    return { type: 'str', value: n };
  }
  readNumber() {
    let t = !1;
    return {
      type: 'num',
      value: Number(
        this.readWhile((n) =>
          n === '.' ? (t ? !1 : ((t = !0), !0)) : e.isDigit(n),
        ),
      ),
    };
  }
  static isWhitespace(t) {
    return (
      ` 	
`.indexOf(t) >= 0
    );
  }
  static isOpChar(t) {
    return '.=!|+-*/%?<>,'.indexOf(t) >= 0;
  }
  static isPuncChar(t) {
    return '()[]{}:;\\'.indexOf(t) >= 0;
  }
  static isDigit(t) {
    return /[0-9]/.test(t);
  }
  static isIdentStart(t) {
    return /[a-zA-Z@$_]/.test(t);
  }
  static isIdentChar(t) {
    return e.isIdentStart(t) || /[0-9]/.test(t);
  }
  getEscaped(t) {
    let n = t;
    if (!e.escapeCharacters[n])
      throw this.croak(`Can't parse an escape character: ${t}`, 'tokenize');
    return e.escapeCharacters[n];
  }
  static stringifyTokenType(t) {
    return this.tokenTypeToString[t];
  }
  static stringifyToken(t) {
    return t === null
      ? 'EOF'
      : ['null', 'bool', 'value'].includes(t.type)
        ? `${this.tokenTypeToString[t.type]}: ${t.value}`
        : `${this.tokenTypeToString[t.type]}: "${t.value}"`;
  }
};
var _e = class e {
  constructor(t) {
    this.input = t;
  }
  static precedence = {
    '|': 1,
    ',': 2,
    '//': 3,
    '=': 4,
    '|=': 4,
    '+=': 4,
    '-=': 4,
    '*=': 4,
    '/=': 4,
    '%=': 4,
    '//=': 4,
    or: 5,
    and: 6,
    '==': 7,
    '!=': 7,
    '<': 7,
    '>': 7,
    '<=': 7,
    '>=': 7,
    '+': 8,
    '-': 8,
    '*': 9,
    '/': 9,
    '%': 9,
    '?//': 10,
  };
  static getPrecedence(t) {
    return e.precedence[t];
  }
  static normalizeBinaryAst(t) {
    return t.right.type === 'binary' &&
      !t.right.parenthesized &&
      this.getPrecedence(t.operator) === this.getPrecedence(t.right.operator)
      ? this.normalizeBinaryAst({
          type: 'binary',
          left: this.normalizeBinaryAst({
            type: 'binary',
            left: t.left,
            operator: t.operator,
            right: t.right.left,
          }),
          operator: t.right.operator,
          right:
            t.right.right.type === 'binary'
              ? this.normalizeBinaryAst(t.right.right)
              : t.right.right,
        })
      : t;
  }
  static getFilterName(t, n) {
    return `${t}/${n}`;
  }
  static getFilterIdent(t) {
    return t.split('/')[0];
  }
  static getFilterArity(t) {
    return Number(t.split('/')[1]);
  }
  static staticIndexPath(t, n) {
    if (typeof n == 'string') {
      if (t.type === 'identity') return [n];
      if (t.type === 'index' && t.staticPath) return [...t.staticPath, n];
    }
  }
  parse() {
    return this.parseTopLevel();
  }
  unexpected() {
    return this.input.croak(
      `Unexpected ${pe.stringifyToken(this.input.peek())}`,
    );
  }
  expected(t, n) {
    let r = this.input.peek();
    return this.input.croak(
      `Expected ${n ? pe.stringifyToken({ type: t, value: n }) : pe.stringifyTokenType(t)}, received ${pe.stringifyToken(r)}`,
    );
  }
  is(t, n) {
    let r = this.input.peek();
    return ((r && r.type === t && (!n || n === r.value)) || null) && r;
  }
  skip(t, n) {
    if (this.is(t, n)) return this.input.next();
    throw this.expected(t, n);
  }
  isKw(t) {
    return this.is('kw', t);
  }
  isVar(t) {
    return this.is('var', t);
  }
  isIdent(t) {
    return this.is('ident', t);
  }
  isFormat(t) {
    return this.is('format', t);
  }
  isPunc(t) {
    return this.is('punc', t);
  }
  isOp(t) {
    return this.is('op', t);
  }
  isBool(t) {
    return this.is('bool', t);
  }
  isStr(t) {
    return this.is('str', t);
  }
  isNum(t) {
    return this.is('num', t);
  }
  isNull() {
    return this.is('null');
  }
  skipPunc(t) {
    return this.skip('punc', t);
  }
  skipKw(t) {
    return this.skip('kw', t);
  }
  skipVar(t) {
    return this.skip('var', t);
  }
  skipFormat(t) {
    return this.skip('format', t);
  }
  skipIdent(t) {
    return this.skip('ident', t);
  }
  skipOp(t) {
    return this.skip('op', t);
  }
  skipBool(t) {
    return this.skip('bool', t);
  }
  skipStr(t) {
    return this.skip('str', t);
  }
  skipNum(t) {
    return this.skip('num', t);
  }
  skipNull() {
    return this.skip('null');
  }
  parseTopLevel() {
    let t;
    if ((this.input.eof() || (t = this.parseExpression()), !this.input.eof()))
      throw this.unexpected();
    return { type: 'root', expr: t };
  }
  parseDef() {
    this.skipKw('def');
    let t = this.skipIdent().value,
      n = this.isPunc('(')
        ? this.delimited('(', ')', ';', () => this.parseArgName())
        : [],
      r = e.getFilterName(t, n.length);
    this.skipPunc(':');
    let i = this.parseExpression();
    this.skipPunc(';');
    let o = { type: 'def', name: r, args: n, body: i };
    return (this.input.eof() || (o.next = this.parseExpression()), o);
  }
  delimited(t, n, r, i, o = 0, s, a) {
    this.skipPunc(t);
    let u = [],
      l = !0,
      c = 0;
    for (
      ;
      (c < o || (!this.input.eof() && !this.isPunc(n) && (!s || c < s))) &&
      (l || (typeof r == 'string' ? this.skipPunc(r) : this.skipOp(r.value)),
      !(a && this.isPunc(n)));
    )
      (u.push(i()), (l = !1), c++);
    return (
      a &&
        (typeof r == 'string'
          ? this.isPunc(r) && this.skipPunc(r)
          : this.isOp(r.value) && this.skipOp(r.value)),
      this.skipPunc(n),
      u
    );
  }
  parseArgName() {
    let t = this.input.next();
    switch (t?.type) {
      case 'ident':
        return { type: 'filterArg', name: e.getFilterName(t.value, 0) };
      case 'var':
        return { type: 'varArg', name: t.value };
    }
    throw this.input.croak('Expecting argument name');
  }
  parseExpression(t) {
    return this.maybeBinary(this.parseAtomOrControlStructure(), 0, t);
  }
  maybeShortTry(t) {
    let n = t();
    if (this.isOp('?')) {
      this.skipOp('?');
      let r = { type: 'try', short: !0, body: n };
      return this.atomMaybe(() => r);
    }
    return n;
  }
  parseAtomOrControlStructure() {
    return this.isKw('label')
      ? this.parseLabel()
      : this.isKw('break')
        ? this.parseBreak()
        : this.isKw('try')
          ? this.parseTry()
          : this.isKw('if')
            ? this.parseIf()
            : this.isKw('reduce')
              ? this.parseReduce()
              : this.isKw('foreach')
                ? this.parseForeach()
                : this.parseAtom(!0);
  }
  parseAtom(t) {
    if (this.isKw('def')) return this.parseDef();
    if (this.isOp('-'))
      return {
        type: 'unary',
        operator: this.skipOp('-').value,
        expr: this.parseAtomOrControlStructure(),
      };
    let n = () =>
      this.atomMaybe(() => {
        if (this.isPunc('(')) {
          this.input.next();
          let r = this.parseExpression();
          return (
            this.skipPunc(')'),
            r.type === 'binary' && (r.parenthesized = !0),
            r
          );
        }
        if (this.isOp('.')) return this.parseIdentity();
        if (this.isOp('..')) return this.parseRecursiveDescent();
        if (this.isPunc('[')) return this.parseArray();
        if (this.isPunc('{')) return this.parseObject();
        if (this.isVar()) return this.parseVar();
        if (this.isIdent() || this.isKw('not')) return this.parseFilter();
        if (this.isFormat()) return this.parseFormat();
        if (this.isStr()) return this.parseStr();
        if (this.isNum() || this.isBool() || this.isNull())
          return this.input.next();
        throw this.unexpected();
      });
    return t ? this.maybeVariable(n) : n();
  }
  maybeBinary(t, n = 0, r = []) {
    let i = this.isOp() || this.isKw('and') || this.isKw('or');
    if (i && !r.includes(i.value)) {
      let o = e.getPrecedence(i.value);
      if (o > n)
        return (
          this.input.next(),
          this.maybeBinary(
            e.normalizeBinaryAst({
              type: 'binary',
              operator: i.value,
              left: t,
              right: this.maybeBinary(this.parseAtomOrControlStructure(), o, r),
            }),
            n,
            r,
          )
        );
    }
    return t;
  }
  parseIdentity() {
    return (this.skipOp('.'), { type: 'identity' });
  }
  parseRecursiveDescent() {
    return (this.skipOp('..'), { type: 'recursiveDescent' });
  }
  atomMaybe(t) {
    return this.maybeShortTry(() =>
      this.maybeBracketIndex(() => this.maybeSimpleIndex(t)),
    );
  }
  maybeVariable(t) {
    let n = t();
    if (this.isKw('as')) {
      this.skipKw('as');
      let r = [this.parseDestructuring()];
      for (; this.isOp('?//'); )
        (this.skipOp('?//'), r.push(this.parseDestructuring()));
      this.skipOp('|');
      let i = this.parseExpression();
      return { type: 'varDeclaration', expr: n, destructuring: r, next: i };
    }
    return n;
  }
  parseDestructuring() {
    return this.isPunc('[')
      ? this.parseArrayDestructuring()
      : this.isPunc('{')
        ? this.parseObjectDestructuring()
        : this.parseVar();
  }
  parseArrayDestructuring() {
    return {
      type: 'arrayDestructuring',
      destructuring: this.delimited('[', ']', { type: 'op', value: ',' }, () =>
        this.parseDestructuring(),
      ),
    };
  }
  parseObjectDestructuring() {
    return {
      type: 'objectDestructuring',
      entries: this.delimited('{', '}', { type: 'op', value: ',' }, () => {
        if (this.isVar()) return { key: this.parseVar() };
        let t;
        return (
          this.isIdent()
            ? (t = this.skipIdent().value)
            : this.isPunc('(')
              ? (this.skipPunc('('),
                (t = this.parseExpression()),
                this.skipPunc(')'))
              : (t = this.parseStr()),
          this.skipPunc(':'),
          { key: t, destructuring: this.parseDestructuring() }
        );
      }),
    };
  }
  maybeBracketIndex(t) {
    let n = t();
    if (this.isPunc('[')) {
      let r;
      if ((this.skipPunc('['), this.isPunc(']')))
        r = { type: 'iterator', expr: n };
      else {
        let i = this.isPunc(':') ? void 0 : this.parseExpression();
        if (this.isPunc(':')) {
          this.skipPunc(':');
          let o = this.isPunc(']') ? void 0 : this.parseExpression();
          r = { type: 'slice', expr: n, from: i, to: o };
        } else
          r = {
            type: 'index',
            expr: n,
            index: i,
            staticPath: e.staticIndexPath(n, i),
          };
      }
      return (this.skipPunc(']'), this.atomMaybe(() => r));
    }
    return n;
  }
  maybeSimpleIndex(t) {
    let n = t();
    if (
      (n.type !== 'identity' && this.isOp('.') && this.skipOp('.'),
      this.isStr() || this.isIdent())
    ) {
      let r = {
        type: 'index',
        expr: n,
        index: this.isStr() ? this.parseStr() : this.skipIdent().value,
      };
      return (
        (r.staticPath = e.staticIndexPath(n, r.index)),
        this.atomMaybe(() => r)
      );
    }
    return n;
  }
  parseVar() {
    return { type: 'var', name: this.skipVar().value };
  }
  parseFilter() {
    let t = this.isKw('not') ? this.skipKw().value : this.skipIdent().value,
      n = this.isPunc('(')
        ? this.delimited('(', ')', ';', () => this.parseExpression())
        : [],
      r = n.length;
    return { type: 'filter', name: e.getFilterName(t, r), arity: r, args: n };
  }
  parseFormat() {
    let n = { type: 'format', name: this.skipFormat().value };
    return this.isStr() ? this.parseStr(n) : n;
  }
  parseArray() {
    if ((this.skipPunc('['), this.isPunc(']')))
      return (this.skipPunc(']'), { type: 'array' });
    let t = this.parseExpression();
    return (this.skipPunc(']'), { type: 'array', expr: t });
  }
  parseObject() {
    return {
      type: 'object',
      entries: this.delimited(
        '{',
        '}',
        { type: 'op', value: ',' },
        () => this.parseEntry(),
        void 0,
        void 0,
        !0,
      ),
    };
  }
  parseEntry() {
    let t;
    if (this.isIdent() || this.isKw()) {
      if (
        ((t = this.isIdent() ? this.skipIdent().value : this.skipKw().value),
        !this.isPunc(':'))
      )
        return { key: t };
    } else if (this.isPunc('('))
      (this.skipPunc('('), (t = this.parseExpression()), this.skipPunc(')'));
    else if (this.isStr()) t = this.parseStr();
    else throw this.unexpected();
    this.skipPunc(':');
    let n = this.parseExpression([',']);
    return { key: t, value: n };
  }
  parseStr(t) {
    let n = this.skipStr(),
      r;
    if (this.isPunc('\\(')) {
      let i = [n.value];
      for (; this.isPunc('\\('); )
        (i.push(this.parseInterpolation()), i.push(this.skipStr().value));
      r = { type: 'str', interpolated: !0, parts: i.filter((o) => o !== '') };
    } else r = { type: 'str', interpolated: !1, value: n.value };
    return (t && (r.format = t), r);
  }
  parseInterpolation() {
    this.skipPunc('\\(');
    let t = this.parseExpression();
    return (this.skipPunc(')'), t);
  }
  parseIf() {
    this.skipKw('if');
    let t = this.parseExpression();
    this.skipKw('then');
    let n = this.parseExpression(),
      r = [];
    for (; this.isKw('elif'); ) {
      this.skipKw('elif');
      let o = this.parseExpression();
      this.skipKw('then');
      let s = this.parseExpression();
      r.push({ cond: o, then: s });
    }
    let i;
    return (
      this.isKw('else') && (this.skipKw('else'), (i = this.parseExpression())),
      this.skipKw('end'),
      {
        type: 'if',
        cond: t,
        then: n,
        elifs: r.length > 0 ? r : void 0,
        else: i,
      }
    );
  }
  parseTry() {
    this.skipKw('try');
    let t = this.parseExpression(),
      n;
    return (
      this.isKw('catch') &&
        (this.skipKw('catch'), (n = this.parseExpression())),
      { type: 'try', short: !1, body: t, catch: n }
    );
  }
  parseLabel() {
    this.skipKw('label');
    let t = this.skipVar().value;
    this.skipOp('|');
    let n = this.parseExpression();
    return { type: 'label', value: t, next: n };
  }
  parseBreak() {
    return (
      this.skipKw('break'),
      { type: 'break', value: this.skipVar().value }
    );
  }
  parseReduce() {
    this.skipKw('reduce');
    let t = this.parseAtom(!1);
    this.skipKw('as');
    let n = this.skipVar().value,
      r = this.delimited('(', ')', ';', () => this.parseExpression(), 2, 2);
    return { type: 'reduce', expr: t, var: n, init: r[0], update: r[1] };
  }
  parseForeach() {
    this.skipKw('foreach');
    let t = this.parseAtom(!1);
    this.skipKw('as');
    let n = this.skipVar().value,
      r = this.delimited('(', ')', ';', () => this.parseExpression(), 2, 3);
    return {
      type: 'foreach',
      expr: t,
      var: n,
      init: r[0],
      update: r[1],
      extract: r[2],
    };
  }
};
function ii(e) {
  return new _e(new pe(new Xe(e))).parse();
}
te();
it();
Q();
te();
Q();
function Ie(e, t, n) {
  if (t.length === 0) return n;
  let r = b(e),
    i = at(r === 'array' ? e.length : 0, t),
    o = i[0],
    s = e == null ? (b(o) === 'string' ? {} : []) : Fn(e);
  if ((W(s, o), i.length === 1))
    if (H(o)) {
      if (b(n) !== 'array')
        throw new R('An array slice can only be assigned an array');
      s.splice(o.start, o.end - o.start, ...n);
    } else s[o] = n;
  else {
    if (H(o))
      throw new R('setPath: Leading slice accessors are not normalized');
    s[o] = Ie(s[o], i.slice(1), n);
  }
  return s;
}
function* Ft(e, t) {
  let n = !0,
    r = [];
  for (let i of e) {
    let o = n ? t : r;
    (yield [
      i,
      (function* () {
        for (let s of o) (n && r.push(s), yield s);
      })(),
    ],
      (n = !1));
  }
}
function* fi(e, t) {
  for (let [n, r] of Ft(e, t)) for (let i of r) yield [n, i];
}
te();
Q();
function $e(e, t) {
  if (t.length === 0) return e;
  let n = b(e),
    r = at(n === 'array' ? e.length : 0, t),
    i = r[0];
  if ((e == null && (e = b(i) === 'string' ? {} : []), W(e, i), r.length === 1))
    return H(i) ? e.slice(i.start, i.end) : (e[i] ?? null);
  if (H(i)) throw new R('getPath: Leading slice accessors are not normalized');
  return $e(e[i], r.slice(1));
}
var Cs = {
  '|': 3,
  ',': 4,
  '//': 5,
  '=': 1,
  '|=': 1,
  '+=': 1,
  '-=': 1,
  '*=': 1,
  '/=': 1,
  '%=': 1,
  '//=': 1,
  or: 2,
  and: 2,
  '==': 0,
  '!=': 0,
  '<': 0,
  '>': 0,
  '<=': 0,
  '>=': 0,
  '+': 0,
  '-': 0,
  '*': 0,
  '/': 0,
  '%': 0,
  '?//': 6,
};
function $s(e) {
  return Cs[e];
}
function ve(e, t) {
  return $s(e) === t;
}
te();
Q();
var Ms = {
    maxSteps: 25e4,
    maxOutputs: 1e4,
    maxOutputBytes: 5e6,
    maxMillis: 2e3,
  },
  Ut = [];
function ct() {
  return Ut[Ut.length - 1];
}
var lt = class extends Error {
    constructor(n) {
      super(`jq halted with exit code ${n}`);
      this.exitCode = n;
      this.name = 'HaltSignal';
    }
  },
  Me = class extends R {
    constructor(n, r) {
      super(r);
      this.limit = n;
      this.name = 'RuntimeLimitError';
    }
  };
function Os(e = {}) {
  return { ...Ms, ...e };
}
function zt(e) {
  return Number.isFinite(e) && e >= 0;
}
function Bs(e) {
  try {
    return JSON.stringify(e)?.length ?? 4;
  } catch {
    return 0;
  }
}
function mi(e, t) {
  let n = {
    debugMessages: [],
    stderr: [],
    limits: Os(t),
    startMillis: Date.now(),
    steps: 0,
    outputs: 0,
    outputBytes: 0,
  };
  Ut.push(n);
  try {
    return {
      result: e(),
      diagnostics: {
        debugMessages: [...n.debugMessages],
        stderr: [...n.stderr],
        haltedExitCode: n.haltedExitCode,
      },
    };
  } catch (r) {
    return {
      diagnostics: {
        debugMessages: [...n.debugMessages],
        stderr: [...n.stderr],
        haltedExitCode: n.haltedExitCode,
      },
      error: r,
    };
  } finally {
    Ut.pop();
  }
}
function v(e = 1) {
  let t = ct();
  if (t) {
    if (t.limits.signal?.aborted)
      throw new Me(
        'signal',
        `BXL evaluation aborted${t.limits.signal.reason ? `: ${String(t.limits.signal.reason)}` : ''}`,
      );
    if (((t.steps += e), zt(t.limits.maxSteps) && t.steps > t.limits.maxSteps))
      throw new Me(
        'maxSteps',
        `BXL evaluation exceeded the ${t.limits.maxSteps} step runtime limit`,
      );
    if (
      zt(t.limits.maxMillis) &&
      t.steps % 1024 === 0 &&
      Date.now() - t.startMillis > t.limits.maxMillis
    )
      throw new Me(
        'maxMillis',
        `BXL evaluation exceeded the ${t.limits.maxMillis}ms runtime limit`,
      );
  }
}
function hi(e) {
  let t = ct();
  if ((v(), !!t)) {
    if (
      (t.outputs++, zt(t.limits.maxOutputs) && t.outputs > t.limits.maxOutputs)
    )
      throw new Me(
        'maxOutputs',
        `BXL evaluation exceeded the ${t.limits.maxOutputs} output runtime limit`,
      );
    if (
      ((t.outputBytes += Bs(e)),
      zt(t.limits.maxOutputBytes) && t.outputBytes > t.limits.maxOutputBytes)
    )
      throw new Me(
        'maxOutputBytes',
        `BXL evaluation exceeded the ${t.limits.maxOutputBytes} byte output runtime limit`,
      );
  }
}
function yi(e) {
  ct()?.debugMessages.push(e);
}
function Xn(e) {
  ct()?.stderr.push(e);
}
function Ds(e) {
  let t = ct();
  t && (t.haltedExitCode = e);
}
function Gn(e) {
  throw (Ds(e), new lt(e));
}
function qn(e) {
  return we(e);
}
function Oe(e, t, n) {
  return new R(`Operator ${e} cannot be applied to ${b(t)} and ${b(n)}`);
}
function Ps(e) {
  return new R(`applyBinary: Cannot apply operator '${e}'`);
}
function pt(e, t) {
  let n = gi(e),
    r = gi(t);
  return n !== null && r !== null ? [n, r] : null;
}
function gi(e) {
  return typeof e == 'number' && !Number.isNaN(e)
    ? e
    : e == null
      ? 0
      : typeof e == 'boolean'
        ? e
          ? 1
          : 0
        : typeof e == 'string' && e !== '' && !Number.isNaN(Number(e))
          ? parseFloat(e)
          : null;
}
function Be(e, t, n) {
  if (
    (e === '/' || e === '*' || e === '-' || e === '%') &&
    (t == null || n == null)
  )
    return null;
  switch (e) {
    case '==':
      return M(t, n) === 0;
    case '!=':
      return M(t, n) !== 0;
    case '<':
      return M(t, n) < 0;
    case '>':
      return M(t, n) > 0;
    case '<=':
      return M(t, n) <= 0;
    case '>=':
      return M(t, n) >= 0;
    case '+':
      if (t == null && n == null) return null;
      if (t == null) return n;
      if (n == null) return t;
      if (!Dn(t, n)) {
        let r = pt(t, n);
        if (r) return r[0] + r[1];
        throw Oe(e, t, n);
      }
      switch (b(t)) {
        case 'string':
        case 'number':
          return t + n;
        case 'array':
          return [...t, ...n];
        case 'object':
          return { ...t, ...n };
        default:
          throw Oe(e, t, n);
      }
    case '-':
      if (!Dn(t, n)) {
        let r = pt(t, n);
        if (r) return r[0] - r[1];
        throw Oe(e, t, n);
      }
      switch (b(t)) {
        case 'number':
          return t - n;
        case 'array':
          return t.filter((r) => !n.some((i) => M(r, i) === 0));
        default:
          throw Oe(e, t, n);
      }
    case '*':
      if (ee(t, n, 'number')) return t * n;
      if (ui(t, n, 'string', 'number')) {
        let r = b(t) === 'string' ? t : n,
          i = b(t) === 'number' ? t : n;
        return ci(r, i);
      } else if (ee(t, n, 'object')) return Pn(t, n);
      {
        let r = pt(t, n);
        if (r) return r[0] * r[1];
      }
      throw Oe(e, t, n);
    case '/':
      if (ee(t, n, 'number')) return n === 0 ? null : t / n;
      if (ee(t, n, 'string')) return t.split(n);
      {
        let r = pt(t, n);
        if (r) return r[1] === 0 ? null : r[0] / r[1];
      }
      throw Oe(e, t, n);
    case '%':
      if (ee(t, n, 'number'))
        return Math.floor(n) === 0 ? null : Math.floor(t) % Math.floor(n);
      {
        let r = pt(t, n);
        if (r)
          return Math.floor(r[1]) === 0
            ? null
            : Math.floor(r[0]) % Math.floor(r[1]);
      }
      throw Oe(e, t, n);
    default:
      throw Ps(e);
  }
}
function* bi(e, t, n) {
  for (let [r, i] of Ft(Ye(n), st(t))) {
    v();
    let o = e.value;
    for (let s of i) (v(), (o = Ie(o, ut(s, e.path), we(r))));
    yield E(o);
  }
}
function* xi(e, t, n, r) {
  for (let [i, o] of Ft(Ye(r), st(n))) {
    v();
    let s = t.value;
    for (let a of o) {
      v();
      let u = ut(a, t.path),
        l = e.slice(0, -1),
        c = $e(s, u);
      s = Ie(s, u, ve(l, 5) ? Fs(c, i) : Be(l, c, i));
    }
    yield E(s);
  }
}
function* wi(e, t, n) {
  if (e !== 'and' && e !== 'or')
    throw new R(`evaluateBooleanOperator: Unexpected operator '${e}'`);
  let r = !0,
    i = [];
  for (let o of t) {
    v();
    let s = r ? n : i;
    if (e === 'and' && !q(o.value)) {
      yield E(!1);
      continue;
    } else if (e === 'or' && q(o.value)) {
      yield E(!0);
      continue;
    }
    for (let a of s) (v(), r && i.push(a), yield E(q(a.value)));
    r = !1;
  }
}
function* Ai(e, t, n) {
  for (let [r, i] of fi(n, t)) (v(), yield E(Be(e, i.value, r.value)));
}
function Fs(e, t) {
  return q(e) ? e : t;
}
function* Ii(e, t) {
  let n = !1;
  for (let r of e) (v(), q(r.value) && (yield r, (n = !0)));
  n || (yield* t);
}
te();
function* he(e) {
  if (e.some((n) => n.length === 0)) return;
  let t = e.map((n) => 0);
  do yield Us(e, t);
  while (zs(e, t));
}
function Us(e, t) {
  return t.map((n, r) => e[r][n]);
}
function zs(e, t) {
  for (let n = t.length - 1; n >= 0; n--) {
    if ((t[n]++, t[n] < e[n].length)) return !0;
    t[n] = 0;
  }
  return !1;
}
function* vi(e) {
  let t = e.flat();
  for (let n of he(t)) yield js(n);
}
function js(e) {
  let t = e.reduce(
    (n, r, i) => (i % 2 === 0 ? n.push([r]) : n[n.length - 1].push(r), n),
    [],
  );
  return Object.fromEntries(t);
}
Q();
Q();
rt();
te();
var Vs = /^[A-Za-z0-9\-._~]$/;
function dt(e) {
  return `${b(e)} (${G(e)})`;
}
function jt(e) {
  return JSON.stringify(e) ?? 'null';
}
function Xs(e) {
  return e
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;');
}
function Gs(e) {
  let t = '';
  for (let n of new TextEncoder().encode(e)) {
    let r = String.fromCharCode(n);
    Vs.test(r)
      ? (t += r)
      : (t += `%${n.toString(16).toUpperCase().padStart(2, '0')}`);
  }
  return t;
}
function qs(e) {
  try {
    return decodeURIComponent(e);
  } catch {
    throw new R(`${dt(e)} is not a valid uri encoding`);
  }
}
function Ys(e) {
  let t = new TextEncoder().encode(e),
    n = '';
  for (let r of t) n += String.fromCharCode(r);
  return btoa(n);
}
function Hs(e) {
  try {
    let t = atob(e),
      n = Uint8Array.from(t, (r) => r.charCodeAt(0));
    return new TextDecoder().decode(n);
  } catch {
    throw new R(`${dt(e)} is not valid base64 data`);
  }
}
function Ri(e, t) {
  if (b(e) !== 'array')
    throw new R(`${dt(e)} cannot be ${t}-formatted, only array`);
  return e
    .map((n) => {
      switch (b(n)) {
        case 'null':
          return '';
        case 'boolean':
          return jt(n);
        case 'number':
          return Number.isNaN(n) ? '' : jt(n);
        case 'string':
          return t === 'csv'
            ? `"${n.replace(/"/g, '""')}"`
            : n
                .replace(/\\/g, '\\\\')
                .replace(/\t/g, '\\t')
                .replace(/\r/g, '\\r')
                .replace(/\n/g, '\\n');
        default:
          throw new R(`${dt(n)} is not valid in a ${t} row`);
      }
    })
    .join(t === 'csv' ? ',' : '	');
}
function Ws(e) {
  return (b(e) === 'array' ? e : [e])
    .map((n) => {
      switch (b(n)) {
        case 'null':
        case 'boolean':
        case 'number':
          return jt(n);
        case 'string':
          return `'${n.replace(/'/g, "'\\''")}'`;
        default:
          throw new R(`${dt(n)} can not be escaped for shell`);
      }
    })
    .join(' ');
}
function Si(e) {
  switch (e.startsWith('@') ? e.slice(1) : e) {
    case 'text':
      return (t) => G(t);
    case 'json':
      return (t) => jt(t);
    case 'html':
      return (t) => Xs(G(t));
    case 'uri':
      return (t) => Gs(G(t));
    case 'urid':
      return (t) => qs(G(t));
    case 'csv':
      return (t) => Ri(t, 'csv');
    case 'tsv':
      return (t) => Ri(t, 'tsv');
    case 'sh':
      return (t) => Ws(t);
    case 'base64':
      return (t) => Ys(G(t));
    case 'base64d':
      return (t) => Hs(G(t));
    default:
      return;
  }
}
function Ti(e, t) {
  let n = Si(e);
  if (!n) throw new R(`${e} is not a valid format`);
  return n(t);
}
function He(e, t) {
  if (e === void 0) return G(t);
  let n = Si(e.name);
  if (!n) throw Bt(e.name);
  return n(t);
}
De();
rt();
te();
Q();
function Xt(e) {
  let t = {},
    n = ii(e).expr;
  for (; n; ) {
    if (n.type !== 'def')
      throw new R('Could not parse the built-in jq filters');
    ((t[n.name] = n), (n = n.next));
  }
  return t;
}
var Gt = Xt(`
def halt_error: halt_error(5);
def error(msg): msg|error;
def map(f): [.[] | f];
def select(f): if f then . else empty end;
def sort_by(f): _sort_by_impl(map([f]));
def group_by(f): _group_by_impl(map([f]));
def unique: group_by(.) | map(.[0]);
def unique_by(f): group_by(f) | map(.[0]);
def max_by(f): _max_by_impl(map([f]));
def min_by(f): _min_by_impl(map([f]));
def add(f): reduce f as $x (null; . + $x);
def add: reduce .[] as $x (null; . + $x);
def abs: if . < 0 then - . else . end;
def del(f): delpaths([path(f)]);
def _assign(paths; $value): reduce path(paths) as $p (.; setpath($p; $value));
def _modify(paths; update):
    reduce path(paths) as $p (.;
        . as $dot
      | null
      | label $out
      | ($dot | getpath($p)) as $v
      | (
          (   $v
            | update
            | (., break $out) as $v
            | $dot
            | setpath($p; $v)
          ),
          (
              $dot
            | delpaths([$p])
          )
        )
    );
def map_values(f): .[] |= f;

# recurse
def recurse(f): def r: ., (f | r); r;
def recurse(f; cond): def r: ., (f | select(cond) | r); r;
def recurse: recurse(.[]?);
def recurse_down: recurse;

def to_entries: [keys_unsorted[] as $k | {key: $k, value: .[$k]}];
def from_entries: map({(.key // .Key // .name // .Name): (if has("value") then .value else .Value end)}) | add | .//={};
def with_entries(f): to_entries | map(f) | from_entries;
def reverse: [.[length - 1 - range(0;length)]];
def indices($i): if type == "array" and ($i|type) == "array" then .[$i]
  elif type == "array" then .[[$i]]
  elif type == "string" and ($i|type) == "string" then _strindices($i)
  else .[$i] end;
def index($i):   indices($i) | .[0];       # TODO: optimize
def rindex($i):  indices($i) | .[-1:][0];  # TODO: optimize
def paths: path(recurse(if (type|. == "array" or . == "object") then .[] else empty end))|select(length > 0);
def paths(node_filter): . as $dot|paths|select(. as $p|$dot|getpath($p)|node_filter);
def isfinite: type == "number" and (isinfinite | not);
def arrays: select(type == "array");
def objects: select(type == "object");
def iterables: select(type|. == "array" or . == "object");
def booleans: select(type == "boolean");
def numbers: select(type == "number");
def normals: select(isnormal);
def finites: select(isfinite);
def strings: select(type == "string");
def nulls: select(. == null);
def values: select(. != null);
def scalars: select(type|. != "array" and . != "object");
def leaf_paths: paths(scalars);
def join($x): reduce .[] as $i (null;
            (if .==null then "" else .+$x end) +
            ($i | if type=="boolean" or type=="number" then tostring else .//"" end)
        ) // "";
def _flatten($x): reduce .[] as $i ([]; if $i | type == "array" and $x != 0 then . + ($i | _flatten($x-1)) else . + [$i] end);
def flatten($x): if $x < 0 then error("flatten depth must not be negative") else _flatten($x) end;
def flatten: _flatten(-1);
def range($x): range(0;$x);
def fromdateiso8601: strptime("%Y-%m-%dT%H:%M:%SZ")|mktime;
def todateiso8601: strftime("%Y-%m-%dT%H:%M:%SZ");
def fromdate: fromdateiso8601;
def todate: todateiso8601;
def match(re; mode): _match_impl(re; mode; false)|.[];
def match($val): ($val|type) as $vt | if $vt == "string" then match($val; null)
   elif $vt == "array" and ($val | length) > 1 then match($val[0]; $val[1])
   elif $vt == "array" and ($val | length) > 0 then match($val[0]; null)
   else error( $vt + " not a string or array") end;
def test(re; mode): _match_impl(re; mode; true);
def test($val): ($val|type) as $vt | if $vt == "string" then test($val; null)
   elif $vt == "array" and ($val | length) > 1 then test($val[0]; $val[1])
   elif $vt == "array" and ($val | length) > 0 then test($val[0]; null)
   else error( $vt + " not a string or array") end;
def capture(re; mods): match(re; mods) | reduce ( .captures | .[] | select(.name != null) | { (.name) : .string } ) as $pair ({}; . + $pair);
def capture($val): ($val|type) as $vt | if $vt == "string" then capture($val; null)
   elif $vt == "array" and ($val | length) > 1 then capture($val[0]; $val[1])
   elif $vt == "array" and ($val | length) > 0 then capture($val[0]; null)
   else error( $vt + " not a string or array") end;
def scan($re; $flags):
  match($re; if $flags == null then "g" else "g" + $flags end)
  | if (.captures|length > 0)
      then [ .captures | .[] | .string ]
      else .string
      end;
def scan($re): scan($re; null);
#
# If input is an array, then emit a stream of successive subarrays of length n (or less),
# and similarly for strings.
def _nwise(a; $n): if a|length <= $n then a else a[0:$n] , _nwise(a[$n:]; $n) end;
def _nwise($n): _nwise(.; $n);
#
# splits/1 produces a stream; split/1 is retained for backward compatibility.
def splits($re; flags): . as $s
#  # multiple occurrences of "g" are acceptable
  | [ match($re; "g" + flags) | (.offset, .offset + .length) ]
  | [0] + . +[$s|length]
  | _nwise(2)
  | $s[.[0]:.[1] ] ;
def splits($re): splits($re; null);
#
# split emits an array for backward compatibility
def split($re; flags): [ splits($re; flags) ];
#
# If s contains capture variables, then create a capture object and pipe it to s
def sub($re; s):
  . as $in
  | [match($re)]
  | if length == 0 then $in
    else .[0]
    | . as $r
#  # create the "capture" object:
    | reduce ( $r | .captures | .[] | select(.name != null) | { (.name) : .string } ) as $pair
        ({}; . + $pair)
    | $in[0:$r.offset] + s + $in[$r.offset+$r.length:]
    end ;
#
# If s contains capture variables, then create a capture object and pipe it to s
def sub($re; s; flags):
  def subg: [explode[] | select(. != 103)] | implode;
  # "fla" should be flags with all occurrences of g removed; gs should be non-nil if flags has a g
  def sub1(fla; gs):
    def mysub:
      . as $in
      | [match($re; fla)]
      | if length == 0 then $in
        else .[0] as $edit
        | ($edit | .offset + .length) as $len
        # create the "capture" object:
        | reduce ( $edit | .captures | .[] | select(.name != null) | { (.name) : .string } ) as $pair
            ({}; . + $pair)
        | $in[0:$edit.offset]
          + s
          + ($in[$len:] | if length > 0 and gs then mysub else . end)
        end ;
    mysub ;
    (flags | index("g")) as $gs
    | (flags | if $gs then subg else . end) as $fla
    | sub1($fla; $gs);
#
def sub($re; s): sub($re; s; "");
# repeated substitution of re (which may contain named captures)
def gsub($re; s; flags): sub($re; s; flags + "g");
def gsub($re; s): sub($re; s; "g");

########################################################################
# generic iterator/generator
def while(cond; update):
     def _while:
         if cond then ., (update | _while) else empty end;
     _while;
def until(cond; next):
     def _until:
         if cond then . else (next|_until) end;
     _until;
def limit($n; exp):
    if $n > 0 then label $out | foreach exp as $item ($n; .-1; $item, if . <= 0 then break $out else empty end)
    elif $n == 0 then empty
    else error("limit doesn't support negative count") end;
def skip($n; exp):
    if $n > 0 then foreach exp as $item ($n; . - 1; if . < 0 then $item else empty end)
    elif $n == 0 then exp
    else error("skip doesn't support negative count") end;
# range/3, with a \`by\` expression argument
def range($init; $upto; $by):
    if $by > 0 then $init|while(. < $upto; . + $by)
  elif $by < 0 then $init|while(. > $upto; . + $by)
  else empty end;
def first(g): label $out | g | ., break $out;
def isempty(g): first((g|false), true);
def all(generator; condition): isempty(generator|condition and empty);
def any(generator; condition): isempty(generator|condition or empty)|not;
def all(condition): all(.[]; condition);
def any(condition): any(.[]; condition);
def all: all(.[]; .);
def any: any(.[]; .);
def last(g): reduce g as $item (null; $item);
def nth($n; g): if $n < 0 then error("nth doesn't support negative indices") else last(limit($n + 1; g)) end;
def first: .[0];
def last: .[-1];
def nth($n): .[$n];
def combinations:
    if length == 0 then [] else
        .[0][] as $x
          | (.[1:] | combinations) as $y
          | [$x] + $y
    end;
def combinations(n):
    . as $dot
      | [range(n) | $dot]
      | combinations;
# transpose a possibly jagged matrix, quickly;
# rows are padded with nulls so the result is always rectangular.
def transpose:
  if . == [] then []
  else . as $in
  | (map(length) | max) as $max
  | length as $length
  | reduce range(0; $max) as $j
      ([]; . + [reduce range(0;$length) as $i ([]; . + [ $in[$i][$j] ] )] )
  end;
def in(xs): . as $x | xs | has($x);
def inside(xs): . as $x | xs | contains($x);
def repeat(exp):
     def _repeat:
         exp, _repeat;
     _repeat;
def inputs: try repeat(input) catch if .=="break" then empty else error end;
# ensure the output of debug(m1,m2) is kept together:
def debug(msgs): (msgs | debug | empty), .;
# like ruby's downcase - only characters A to Z are affected
def ascii_downcase:
  explode | map( if 65 <= . and . <= 90 then . + 32  else . end) | implode;
# like ruby's upcase - only characters a to z are affected
def ascii_upcase:
  explode | map( if 97 <= . and . <= 122 then . - 32  else . end) | implode;

# Streaming utilities
def truncate_stream(stream):
  . as $n | null | stream | . as $input | if (.[0]|length) > $n then setpath([0];$input[0][$n:]) else empty end;
def fromstream(i): {x: null, e: false} as $init |
  # .x = object being built; .e = emit and reset state
  foreach i as $i ($init
  ; if .e then $init else . end
  | if $i|length == 2
    then setpath(["e"]; $i[0]|length==0) | setpath(["x"]+$i[0]; $i[1])
    else setpath(["e"]; $i[0]|length==1) end
  ; if .e then .x else empty end);
def tostream:
  path(def r: (.[]?|r), .; r) as $p |
  getpath($p) |
  reduce path(.[]?) as $q ([$p, .]; [$p+$q]);


# Assuming the input array is sorted, bsearch/1 returns
# the index of the target if the target is in the input array; and otherwise
#  (-1 - ix), where ix is the insertion point that would leave the array sorted.
# If the input is not sorted, bsearch will terminate but with irrelevant results.
def bsearch($target):
  if length == 0 then -1
  elif length == 1 then
     if $target == .[0] then 0 elif $target < .[0] then -1 else -2 end
  else . as $in
    # state variable: [start, end, answer]
    # where start and end are the upper and lower offsets to use.
    | [0, length-1, null]
    | until( .[0] > .[1] ;
             if .[2] != null then (.[1] = -1)               # i.e. break
             else
               ( ( (.[1] + .[0]) / 2 ) | floor ) as $mid
               | $in[$mid] as $monkey
               | if $monkey == $target  then (.[2] = $mid)   # success
                 elif .[0] == .[1]     then (.[1] = -1)     # failure
                 elif $monkey < $target then (.[0] = ($mid + 1))
                 else (.[1] = ($mid - 1))
                 end
             end )
    | if .[2] == null then          # compute the insertion point
         if $in[ .[0] ] < $target then (-2 -.[0])
         else (-1 -.[0])
         end
      else .[2]
      end
  end;

# Apply f to composite entities recursively, and to atoms
def walk(f):
  . as $in
  | if type == "object" then
      reduce keys_unsorted[] as $key
        ( {}; . + { ($key):  ($in[$key] | walk(f)) } ) | f
  elif type == "array" then map( walk(f) ) | f
  else f
  end;

# pathexps could be a stream of dot-paths
def pick(pathexps):
  . as $in
  | reduce path(pathexps) as $a (null;
      setpath($a; $in|getpath($a)) );

# SQL-ish operators here:
def INDEX(stream; idx_expr):
  reduce stream as $row ({}; .[$row|idx_expr|tostring] = $row);
def INDEX(idx_expr): INDEX(.[]; idx_expr);
def JOIN($idx; idx_expr):
  [.[] | [., $idx[idx_expr]]];
def JOIN($idx; stream; idx_expr):
  stream | [., $idx[idx_expr]];
def JOIN($idx; stream; idx_expr; join_expr):
  stream | [., $idx[idx_expr]] | join_expr;
def IN(s): any(s == .; .);
def IN(src; s): any(src == s; .);
`);
te();
De();
rt();
it();
Q();
Q();
var Yn = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  Ei = Yn.map((e) => e.slice(0, 3)),
  Hn = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ],
  ki = Hn.map((e) => e.slice(0, 3));
function z(e, t = 2) {
  return Math.trunc(e).toString().padStart(t, '0');
}
function Ks(e) {
  return e - Math.floor(e);
}
function ft(e, t, n, r, i, o, s, a) {
  let u = new Date(0);
  return (
    a === 'utc'
      ? (u.setUTCFullYear(e, t, n), u.setUTCHours(r, i, o, s))
      : (u.setFullYear(e, t, n), u.setHours(r, i, o, s)),
    u
  );
}
function _i(e, t) {
  let n = t === 'utc' ? e.getUTCFullYear() : e.getFullYear(),
    r = ft(n, 0, 1, 0, 0, 0, 0, t);
  return Math.floor((e.getTime() - r.getTime()) / 864e5);
}
function Js(e) {
  return -e.getTimezoneOffset();
}
function Zs(e) {
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
        .formatToParts(e)
        .find((n) => n.type === 'timeZoneName')?.value ?? 'UTC'
    );
  } catch {
    return 'UTC';
  }
}
function Qs(e) {
  let t = e >= 0 ? '+' : '-',
    n = Math.abs(e),
    r = Math.floor(n / 60),
    i = n % 60;
  return `${t}${z(r)}${z(i)}`;
}
function mt(e, t) {
  if (!Number.isFinite(e.getTime()))
    throw new D(`Invalid epoch value for ${t}`);
}
function Ci(e) {
  if (!Array.isArray(e)) throw new D('Expected an array');
  let t = new Array(8).fill(0);
  for (let n = 0; n < Math.min(e.length, 8); n++) {
    let r = e[n];
    if (typeof r != 'number' || Number.isNaN(r))
      throw new D('Expected numeric parsed datetime values');
    t[n] = r;
  }
  return t;
}
function Yt(e, t, n) {
  mt(e, n === 'utc' ? 'strftime' : 'strflocaltime');
  let r = n === 'utc' ? e.getUTCFullYear() : e.getFullYear(),
    i = n === 'utc' ? e.getUTCMonth() : e.getMonth(),
    o = n === 'utc' ? e.getUTCDate() : e.getDate(),
    s = n === 'utc' ? e.getUTCHours() : e.getHours(),
    a = n === 'utc' ? e.getUTCMinutes() : e.getMinutes(),
    u = n === 'utc' ? e.getUTCSeconds() : e.getSeconds(),
    l = n === 'utc' ? e.getUTCDay() : e.getDay(),
    c = _i(e, n);
  return [r, i, o, s, a, u + Ks(t), l, c];
}
function $i(e, t) {
  let n = Ci(e),
    r = n[0],
    i = n[1],
    o = n[2],
    s = n[3],
    a = n[4],
    u = Math.trunc(n[5]);
  return ft(r, i, o, s, a, u, 0, t);
}
function ea(e, t, n, r) {
  let i = Yt(t, r, n),
    [o, s, a, u, l, c, d, p] = i;
  switch (e) {
    case '%':
      return '%';
    case 'Y':
      return z(o, 4);
    case 'm':
      return z(s + 1);
    case 'd':
      return z(a);
    case 'e':
      return `${a}`.padStart(2, ' ');
    case 'H':
      return z(u);
    case 'M':
      return z(l);
    case 'S':
      return z(Math.trunc(c));
    case 'I': {
      let g = u % 12 || 12;
      return z(g);
    }
    case 'p':
      return u < 12 ? 'AM' : 'PM';
    case 'a':
      return ki[d];
    case 'A':
      return Hn[d];
    case 'b':
    case 'h':
      return Ei[s];
    case 'B':
      return Yn[s];
    case 'w':
      return `${d}`;
    case 'u':
      return `${d === 0 ? 7 : d}`;
    case 'j':
      return z(p + 1, 3);
    case 'F':
      return `${z(o, 4)}-${z(s + 1)}-${z(a)}`;
    case 'R':
      return `${z(u)}:${z(l)}`;
    case 'T':
      return `${z(u)}:${z(l)}:${z(Math.trunc(c))}`;
    case 'r': {
      let g = u % 12 || 12,
        x = u < 12 ? 'AM' : 'PM';
      return `${z(g)}:${z(l)}:${z(Math.trunc(c))} ${x}`;
    }
    case 'z':
      return n === 'utc' ? '+0000' : Qs(Js(t));
    case 'Z':
      return n === 'utc' ? 'UTC' : Zs(t);
    default:
      throw new D(`Unsupported strftime format directive: %${e}`);
  }
}
function Se(e, t, n, r) {
  let i = t;
  for (; i < e.length && /\d/.test(e[i]) && i - t < r; ) i += 1;
  if (i - t < n) throw new D('Unexpected numeric field while parsing datetime');
  return { value: Number(e.slice(t, i)), nextIndex: i };
}
function qt(e, t, n) {
  let r = e.slice(t).toLowerCase();
  for (let i = 0; i < n.length; i++) {
    let o = n[i];
    if (r.startsWith(o.toLowerCase()))
      return { value: i, nextIndex: t + o.length };
  }
  throw new D('Unexpected named field while parsing datetime');
}
function Mi(e) {
  let t = new Date(e * 1e3);
  return (mt(t, 'gmtime'), Yt(t, e, 'utc'));
}
function Oi(e) {
  let t = new Date(e * 1e3);
  return (mt(t, 'localtime'), Yt(t, e, 'local'));
}
function Bi(e) {
  let t = Ci(e),
    n = $i(t, 'utc');
  return (mt(n, 'mktime'), Math.floor(n.getTime() / 1e3));
}
function Wn(e, t, n) {
  let r,
    i = 0;
  (typeof e == 'number'
    ? ((i = e), (r = new Date(e * 1e3)))
    : ((r = $i(e, n)), (i = r.getTime() / 1e3)),
    mt(r, n === 'utc' ? 'strftime' : 'strflocaltime'));
  let o = '';
  for (let s = 0; s < t.length; s++) {
    let a = t[s];
    if (a !== '%') {
      o += a;
      continue;
    }
    if (((s += 1), s >= t.length)) throw new D('Trailing % in strftime format');
    o += ea(t[s], r, n, i);
  }
  return o;
}
function Di(e, t) {
  let n = {},
    r = 0;
  function i() {
    for (; r < e.length && /\s/.test(e[r]); ) r += 1;
  }
  for (let x = 0; x < t.length; x++) {
    let w = t[x];
    if (w === '%') {
      if (((x += 1), x >= t.length))
        throw new D('Trailing % in strptime format');
      let S = t[x];
      switch (S) {
        case '%':
          if (e[r] !== '%') throw new D('Literal % did not match input');
          r += 1;
          break;
        case 'Y': {
          let m = Se(e, r, 1, 4);
          ((n.year = m.value), (r = m.nextIndex));
          break;
        }
        case 'm': {
          let m = Se(e, r, 1, 2);
          ((n.month = m.value - 1), (r = m.nextIndex));
          break;
        }
        case 'd':
        case 'e': {
          S === 'e' && i();
          let m = Se(e, r, 1, 2);
          ((n.day = m.value), (r = m.nextIndex));
          break;
        }
        case 'H': {
          let m = Se(e, r, 1, 2);
          ((n.hour = m.value), (r = m.nextIndex));
          break;
        }
        case 'M': {
          let m = Se(e, r, 1, 2);
          ((n.minute = m.value), (r = m.nextIndex));
          break;
        }
        case 'S': {
          let m = /^(\d{1,2}(?:\.\d+)?)/.exec(e.slice(r));
          if (!m)
            throw new D('Unexpected seconds field while parsing datetime');
          ((n.second = Number(m[1])), (r += m[1].length));
          break;
        }
        case 'a': {
          let m = qt(e, r, ki);
          ((n.weekday = m.value), (r = m.nextIndex));
          break;
        }
        case 'A': {
          let m = qt(e, r, Hn);
          ((n.weekday = m.value), (r = m.nextIndex));
          break;
        }
        case 'b':
        case 'h': {
          let m = qt(e, r, Ei);
          ((n.month = m.value), (r = m.nextIndex));
          break;
        }
        case 'B': {
          let m = qt(e, r, Yn);
          ((n.month = m.value), (r = m.nextIndex));
          break;
        }
        case 'w': {
          let m = Se(e, r, 1, 1);
          ((n.weekday = m.value), (r = m.nextIndex));
          break;
        }
        case 'u': {
          let m = Se(e, r, 1, 1);
          ((n.weekday = m.value % 7), (r = m.nextIndex));
          break;
        }
        case 'j': {
          let m = Se(e, r, 1, 3);
          ((n.yearDay = m.value - 1), (r = m.nextIndex));
          break;
        }
        case 'F': {
          let m = /^(\d{1,4})-(\d{1,2})-(\d{1,2})/.exec(e.slice(r));
          if (!m) throw new D('Failed to parse %F datetime fragment');
          ((n.year = Number(m[1])),
            (n.month = Number(m[2]) - 1),
            (n.day = Number(m[3])),
            (r += m[0].length));
          break;
        }
        case 'T': {
          let m = /^(\d{1,2}):(\d{1,2}):(\d{1,2}(?:\.\d+)?)/.exec(e.slice(r));
          if (!m) throw new D('Failed to parse %T datetime fragment');
          ((n.hour = Number(m[1])),
            (n.minute = Number(m[2])),
            (n.second = Number(m[3])),
            (r += m[0].length));
          break;
        }
        case 'z': {
          let m = /^(Z|[+-]\d{2}:?\d{2})/.exec(e.slice(r));
          if (!m) throw new D('Failed to parse %z timezone offset');
          if (m[1] === 'Z') n.offsetMinutes = 0;
          else {
            let T = m[1].replace(':', ''),
              $ = T.startsWith('-') ? -1 : 1,
              F = Number(T.slice(1, 3)),
              U = Number(T.slice(3, 5));
            n.offsetMinutes = $ * (F * 60 + U);
          }
          r += m[0].length;
          break;
        }
        case 'Z': {
          let m = /^(UTC|GMT|Z)/i.exec(e.slice(r));
          if (!m) throw new D('Failed to parse %Z timezone name');
          ((n.offsetMinutes = 0), (r += m[0].length));
          break;
        }
        default:
          throw new D(`Unsupported strptime format directive: %${S}`);
      }
      continue;
    }
    if (/\s/.test(w)) {
      i();
      continue;
    }
    if (e[r] !== w)
      throw new D('Input did not match the strptime format literal');
    r += 1;
  }
  let o = e.slice(r);
  if (/[^\s]/.test(o)) throw new D(`date "${e}" does not match format "${t}"`);
  let s = n.year ?? 0,
    a = n.month ?? 0,
    u = n.day ?? 0,
    l = n.hour ?? 0,
    c = n.minute ?? 0,
    d = n.second ?? 0;
  if (n.yearDay !== void 0 && n.day === void 0 && n.month === void 0) {
    let x = ft(s, 0, 1, 0, 0, 0, 0, 'utc');
    (x.setUTCDate(x.getUTCDate() + n.yearDay),
      (a = x.getUTCMonth()),
      (u = x.getUTCDate()));
  }
  if (n.offsetMinutes !== void 0) {
    let x = Math.trunc(d),
      w = d - x,
      S = ft(s, a, u, l, c, x, Math.round(w * 1e3), 'utc');
    S.setUTCMinutes(S.getUTCMinutes() - n.offsetMinutes);
    let m = Yt(S, S.getTime() / 1e3, 'utc');
    return (
      (s = m[0]),
      (a = m[1]),
      (u = m[2]),
      (d = m[5]),
      o.length > 0 ? [...m, o] : m
    );
  }
  let p = ft(s, a, u, l, c, Math.trunc(d), 0, 'utc'),
    g = [
      s,
      a,
      u,
      l,
      c,
      d,
      n.weekday ?? p.getUTCDay(),
      n.yearDay ?? _i(p, 'utc'),
    ];
  return o.length > 0 ? [...g, o] : g;
}
var ta = 22250738585072014e-324,
  na = new Set(['env/0']);
function Jn(e, t) {
  if (b(e) !== b(t)) return !1;
  switch (b(e)) {
    case 'object':
      return Object.entries(t).every(
        ([n, r]) => Object.prototype.hasOwnProperty.call(e, n) && Jn(e[n], r),
      );
    case 'array':
      return t.every((n) => e.some((r) => Jn(r, n)));
    case 'string': {
      let n = e,
        r = t;
      return r.length === 0 || n.includes(r);
    }
    default:
      return M(e, t) === 0;
  }
}
function Kn(e, t) {
  if (b(e) !== 'string') throw new R('trim input must be a string');
  let n = e;
  return (
    (t === 'both' || t === 'left') && (n = n.trimStart()),
    (t === 'both' || t === 'right') && (n = n.trimEnd()),
    n
  );
}
function ra() {
  return [...new Set([...Object.keys(Gt), ...Object.keys(rr)])]
    .filter((e) => !e.startsWith('_') && !na.has(e))
    .sort();
}
function Li(e) {
  return b(e) === 'string' ? e : (JSON.stringify(qn(e)) ?? 'null');
}
function j(e, t, n) {
  let r = I(e),
    i = n(r);
  return Number.isNaN(i) ? Number.NaN : i;
}
function Pi(e, t, n) {
  return n(I(e), I(t));
}
var ia = new ArrayBuffer(8),
  We = new DataView(ia);
function Vi(e) {
  return (We.setFloat64(0, e), { hi: We.getUint32(0), lo: We.getUint32(4) });
}
function oa(e, t) {
  return (We.setUint32(0, e), We.setUint32(4, t), We.getFloat64(0));
}
function Fi(e, t) {
  if (Number.isNaN(e) || Number.isNaN(t)) return Number.NaN;
  if (e === t) return t;
  if (e === 0) return t > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  let { hi: n, lo: r } = Vi(e);
  return (
    e < t == e > 0
      ? r === 4294967295
        ? ((n = (n + 1) >>> 0), (r = 0))
        : (r = (r + 1) >>> 0)
      : r === 0
        ? ((n = (n - 1) >>> 0), (r = 4294967295))
        : (r = (r - 1) >>> 0),
    oa(n, r)
  );
}
function Zn(e) {
  if (!Number.isFinite(e)) return e;
  let t = Math.trunc(e),
    n = e - t,
    r = Math.abs(n);
  return r < 0.5
    ? t
    : r > 0.5
      ? t + Math.sign(n)
      : t % 2 === 0
        ? t
        : t + Math.sign(n);
}
function Ui(e, t) {
  if (t === 0 || !Number.isFinite(e) || Number.isNaN(t)) return Number.NaN;
  let n = Zn(e / t);
  return e - n * t;
}
function Xi(e) {
  if (e === 0 || !Number.isFinite(e) || Number.isNaN(e)) return [e, 0];
  let { hi: t } = Vi(e),
    n = (t >>> 20) & 2047;
  if (n === 0) {
    let o = e * 0x40000000000000,
      [s, a] = Xi(o);
    return [s, a - 54];
  }
  let r = n - 1022;
  return [e / Math.pow(2, r), r];
}
function zi(e) {
  return e === 0
    ? Number.NEGATIVE_INFINITY
    : Number.isFinite(e)
      ? Number.isNaN(e)
        ? Number.NaN
        : Math.floor(Math.log2(Math.abs(e)))
      : Number.POSITIVE_INFINITY;
}
function ji(e) {
  let t = Math.sign(e),
    n = Math.abs(e),
    r = 0.254829592,
    i = -0.284496736,
    o = 1.421413741,
    s = -1.453152027,
    a = 1.061405429,
    l = 1 / (1 + 0.3275911 * n),
    c = 1 - ((((a * l + s) * l + o) * l + i) * l + r) * l * Math.exp(-n * n);
  return t * c;
}
var Gi = 7,
  Ke = [
    0.9999999999998099, 676.5203681218851, -1259.1392167224028,
    771.3234287776531, -176.6150291621406, 12.507343278686905,
    -0.13857109526572012, 9984369578019572e-21, 15056327351493116e-23,
  ];
function Qn(e) {
  if (Number.isNaN(e)) return Number.NaN;
  if (e < 0.5) return Math.PI / (Math.sin(Math.PI * e) * Qn(1 - e));
  e -= 1;
  let t = Ke[0],
    n = e + Gi + 0.5;
  for (let r = 1; r < Ke.length; r++) t += Ke[r] / (e + r);
  return Math.sqrt(2 * Math.PI) * Math.pow(n, e + 0.5) * Math.exp(-n) * t;
}
function er(e) {
  if (Number.isNaN(e)) return Number.NaN;
  if (e < 0.5)
    return Math.log(Math.abs(Math.PI / Math.sin(Math.PI * e))) - er(1 - e);
  e -= 1;
  let t = Ke[0],
    n = e + Gi + 0.5;
  for (let r = 1; r < Ke.length; r++) t += Ke[r] / (e + r);
  return (
    0.5 * Math.log(2 * Math.PI) + (e + 0.5) * Math.log(n) - n + Math.log(t)
  );
}
function Ht(e) {
  if (e === 0) return 1;
  let t = Math.abs(e);
  if (t < 8) {
    let a = e * e,
      u =
        57568490574 +
        a *
          (-13362590354 +
            a *
              (6516196407e-1 +
                a * (-1121442418e-2 + a * (77392.33017 + a * -184.9052456)))),
      l =
        57568490411 +
        a *
          (1029532985 +
            a *
              (9494680718e-3 + a * (59272.64853 + a * (267.8532712 + a * 1))));
    return u / l;
  }
  let n = 8 / t,
    r = n * n,
    i = t - 0.785398164,
    o =
      1 +
      r *
        (-0.001098628627 +
          r * (2734510407e-14 + r * (-2073370639e-15 + r * 2093887211e-16))),
    s =
      -0.01562499995 +
      r *
        (0.0001430488765 +
          r * (-6911147651e-15 + r * (7621095161e-16 + r * -934935152e-16)));
  return Math.sqrt(0.636619772 / t) * (Math.cos(i) * o - n * Math.sin(i) * s);
}
function Wt(e) {
  if (e === 0) return 0;
  let t = Math.abs(e);
  if (t < 8) {
    let u = e * e,
      l =
        e *
        (72362614232 +
          u *
            (-7895059235 +
              u *
                (2423968531e-1 +
                  u * (-2972611439e-3 + u * (15704.4826 + u * -30.16036606))))),
      c =
        144725228442 +
        u *
          (2300535178 +
            u *
              (1858330474e-2 + u * (99447.43394 + u * (376.9991397 + u * 1))));
    return l / c;
  }
  let n = 8 / t,
    r = n * n,
    i = t - 2.356194491,
    o =
      1 +
      r *
        (0.00183105 +
          r * (-3516396496e-14 + r * (2457520174e-15 + r * -240337019e-15))),
    s =
      0.04687499995 +
      r *
        (-0.0002002690873 +
          r * (8449199096e-15 + r * (-88228987e-14 + r * 105787412e-15))),
    a = Math.sqrt(0.636619772 / t) * (Math.cos(i) * o - n * Math.sin(i) * s);
  return (e < 0 && (a = -a), a);
}
function tr(e) {
  if (e <= 0) return Number.NaN;
  if (e < 8) {
    let s = e * e,
      a =
        -2957821389 +
        s *
          (7062834065 +
            s *
              (-5123598036e-1 +
                s * (1087988129e-2 + s * (-86327.92757 + s * 228.4622733)))),
      u =
        40076544269 +
        s *
          (7452499648e-1 +
            s * (7189466438e-3 + s * (47447.2647 + s * (226.1030244 + s * 1))));
    return a / u + 0.636619772 * Ht(e) * Math.log(e);
  }
  let t = 8 / e,
    n = t * t,
    r = e - 0.785398164,
    i =
      1 +
      n *
        (-0.001098628627 +
          n * (2734510407e-14 + n * (-2073370639e-15 + n * 2093887211e-16))),
    o =
      -0.01562499995 +
      n *
        (0.0001430488765 +
          n * (-6911147651e-15 + n * (7621095161e-16 + n * -934935152e-16)));
  return Math.sqrt(0.636619772 / e) * (Math.sin(r) * i + t * Math.cos(r) * o);
}
function nr(e) {
  if (e <= 0) return Number.NaN;
  if (e < 8) {
    let s = e * e,
      a =
        e *
        (-4900604943e4 +
          s *
            (127527439e5 +
              s *
                (-515343813900 +
                  s * (7349264551 + s * (-4237922726e-2 + s * 85119.37935))))),
      u =
        249958057e6 +
        s *
          (4244419664e3 +
            s *
              (37336503670 +
                s *
                  (2245904002e-1 +
                    s * (102042605e-2 + s * (3549.632885 + s)))));
    return a / u + 0.636619772 * (Wt(e) * Math.log(e) - 1 / e);
  }
  let t = 8 / e,
    n = t * t,
    r = e - 2.356194491,
    i =
      1 +
      n *
        (0.00183105 +
          n * (-3516396496e-14 + n * (2457520174e-15 + n * -240337019e-15))),
    o =
      0.04687499995 +
      n *
        (-0.0002002690873 +
          n * (8449199096e-15 + n * (-88228987e-14 + n * 105787412e-15)));
  return Math.sqrt(0.636619772 / e) * (Math.sin(r) * i + t * Math.cos(r) * o);
}
function qi(e, t) {
  if (((e = Math.trunc(e)), e === 0)) return Ht(t);
  if (e === 1) return Wt(t);
  if (e < 0) return (e & 1 ? -1 : 1) * qi(-e, t);
  if (t === 0) return 0;
  let n = Math.abs(t),
    r = 2 / n;
  if (n > e) {
    let i = Ht(n),
      o = Wt(n);
    for (let s = 1; s < e; s++) {
      let a = s * r * o - i;
      ((i = o), (o = a));
    }
    return t < 0 && e & 1 ? -o : o;
  } else {
    let i = 2 * Math.floor((e + Math.floor(Math.sqrt(40 * e))) / 2),
      o = 0,
      s = 0,
      a = 1,
      u = 0,
      l = 0;
    for (let c = i; c > 0; c--) {
      let d = c * r * a - s;
      ((s = a),
        (a = d),
        Math.abs(a) > 1e10 &&
          ((a *= 1e-10), (s *= 1e-10), (u *= 1e-10), (l *= 1e-10)),
        o && (l += a),
        (o = o ? 0 : 1),
        c === e && (u = s));
    }
    return ((l = 2 * l - a), (u /= l), t < 0 && e & 1 ? -u : u);
  }
}
function sa(e, t) {
  if (((e = Math.trunc(e)), e === 0)) return tr(t);
  if (e === 1) return nr(t);
  if (t <= 0) return Number.NaN;
  let n = 2 / t,
    r = tr(t),
    i = nr(t);
  for (let o = 1; o < e; o++) {
    let s = o * n * i - r;
    ((r = i), (i = s));
  }
  return i;
}
function aa(e) {
  let t = b(e);
  return t === 'null' || t === 'boolean' || t === 'number' || t === 'string';
}
var rr = {
  *'path/1'(e, t) {
    yield E(t.path);
  },
  ...Re({
    *'_negate/0'(e) {
      yield -I(e);
    },
    *'_group_by_impl/1'(e, t) {
      let n = e
          .map((s, a) => ({ value: s, ref: t[a] }))
          .sort((s, a) => M(s.ref, a.ref)),
        r = -1,
        i = [],
        o = [];
      for (let s of n)
        ((r === -1 || M(i[r], s.ref)) && (i.push(s.ref), o.push([]), r++),
          o[r].push(s.value));
      yield o;
    },
    *'_match_impl/3'(e, t, n, r) {
      let i = J(e),
        o = new RegExp(t, (n ?? '') + 'd');
      if (n && n.includes('g')) {
        let s = Array.from(i.matchAll(o));
        r ? yield s.length !== 0 : yield s.map(Vn);
      } else {
        let s = i.match(o);
        r ? yield !!s : s && (yield [Vn(s)]);
      }
    },
    *'_max_by_impl/1'(e, t) {
      if (e.length === 0) return;
      let n = 0;
      for (let r = 1; r < e.length; r++) M(t[r], t[n]) > 0 && (n = r);
      yield e[n];
    },
    *'_min_by_impl/1'(e, t) {
      if (e.length === 0) return;
      let n = 0;
      for (let r = 1; r < e.length; r++) M(t[r], t[n]) < 0 && (n = r);
      yield e[n];
    },
    *'_sort_by_impl/1'(e, t) {
      yield e
        .map((n, r) => ({ item: n, ref: t[r] }))
        .sort(M)
        .map(({ item: n }) => n);
    },
    *'_unique_by_impl/1'(e, t) {
      let n = e
          .map((o, s) => ({ value: o, ref: t[s] }))
          .sort((o, s) => M(o.ref, s.ref)),
        r = [],
        i;
      for (let o of n)
        (!i || M(i, o.ref) !== 0) && (r.push(o.value), (i = o.ref));
      yield r;
    },
    *'_strindices/1'(e, t) {
      yield Ln(e, t);
    },
    *'acos/0'(e) {
      yield j(e, 'acos', Math.acos);
    },
    *'acosh/0'(e) {
      yield j(e, 'acosh', Math.acosh);
    },
    *'asin/0'(e) {
      yield j(e, 'asin', Math.asin);
    },
    *'asinh/0'(e) {
      yield j(e, 'asinh', Math.asinh);
    },
    *'atan/0'(e) {
      yield j(e, 'atan', Math.atan);
    },
    *'atan2/1'(e, t) {
      yield Pi(e, t, Math.atan2);
    },
    *'atan2/2'(e, t, n) {
      let r = I(t),
        i = I(n);
      if (i === 0 && r === 0) {
        yield 0;
        return;
      }
      yield Math.atan2(r, i);
    },
    *'atanh/0'(e) {
      yield j(e, 'atanh', Math.atanh);
    },
    *'bsearch/1'(e, t) {
      if (b(e) !== 'array') throw new D('Expected an array');
      let n = e,
        r = 0,
        i = n.length - 1;
      for (; r <= i; ) {
        let o = Math.floor((r + i) / 2),
          s = M(n[o], t);
        if (s === 0) {
          yield o;
          return;
        }
        s < 0 ? (r = o + 1) : (i = o - 1);
      }
      yield -1 - r;
    },
    *'builtins/0'() {
      yield ra();
    },
    *'cbrt/0'(e) {
      yield j(e, 'cbrt', Math.cbrt);
    },
    *'ceil/0'(e) {
      yield Math.ceil(I(e));
    },
    *'contains/1'(e, t) {
      yield Jn(e, t);
    },
    *'copysign/1'(e, t) {
      let n = Math.abs(I(e)),
        r = I(t);
      yield r === 0 ? n : Math.sign(r) * n;
    },
    *'copysign/2'(e, t, n) {
      let r = Math.abs(I(t)),
        i = I(n);
      yield i === 0 ? r : Math.sign(i) * r;
    },
    *'cos/0'(e) {
      yield j(e, 'cos', Math.cos);
    },
    *'cosh/0'(e) {
      yield j(e, 'cosh', Math.cosh);
    },
    *'debug/0'(e) {
      (yi(JSON.stringify(['DEBUG:', qn(e)])), yield e);
    },
    *'delpaths/1'(e, t) {
      if (!li(t)) throw new D('Expected an array of paths');
      yield Un(e, t);
    },
    *'drem/2'(e, t, n) {
      yield Ui(I(t), I(n));
    },
    *'empty/0'() {},
    *'endswith/1'(e, t) {
      let n = J(e),
        r = J(t);
      yield n.endsWith(r);
    },
    *'env/0'() {
      throw new R('env is not available in the public BXL sandbox');
    },
    *'erf/0'(e) {
      yield ji(I(e));
    },
    *'erfc/0'(e) {
      yield 1 - ji(I(e));
    },
    *'error/0'(e) {
      throw new R(G(e));
    },
    *'exp/0'(e) {
      yield j(e, 'exp', Math.exp);
    },
    *'exp10/0'(e) {
      yield j(e, 'exp10', (t) => 10 ** t);
    },
    *'exp2/0'(e) {
      yield j(e, 'exp2', (t) => 2 ** t);
    },
    *'explode/0'(e) {
      yield Array.from(J(e)).map((t) => t.codePointAt(0));
    },
    *'expm1/0'(e) {
      yield Math.expm1(I(e));
    },
    *'fabs/0'(e) {
      yield Math.abs(I(e));
    },
    *'fdim/1'(e, t) {
      let n = I(e),
        r = I(t);
      yield Math.max(n - r, 0);
    },
    *'fdim/2'(e, t, n) {
      yield Math.max(I(t) - I(n), 0);
    },
    *'floor/0'(e) {
      yield Math.floor(I(e));
    },
    *'fma/3'(e, t, n, r) {
      yield I(t) * I(n) + I(r);
    },
    *'fmax/1'(e, t) {
      yield Math.max(I(e), I(t));
    },
    *'fmax/2'(e, t, n) {
      let r = I(t),
        i = I(n);
      Number.isNaN(r)
        ? yield i
        : Number.isNaN(i)
          ? yield r
          : yield Math.max(r, i);
    },
    *'fmin/1'(e, t) {
      yield Math.min(I(e), I(t));
    },
    *'fmin/2'(e, t, n) {
      let r = I(t),
        i = I(n);
      Number.isNaN(r)
        ? yield i
        : Number.isNaN(i)
          ? yield r
          : yield Math.min(r, i);
    },
    *'fmod/2'(e, t, n) {
      yield I(t) % I(n);
    },
    *'format/1'(e, t) {
      if (b(t) !== 'string')
        throw new R(`${b(t)} (${G(t)}) is not a valid format`);
      yield Ti(t, e);
    },
    *'frexp/0'(e) {
      let [t, n] = Xi(I(e));
      yield [t, n];
    },
    *'fromjson/0'(e) {
      if (b(e) !== 'string')
        throw new R(`${b(e)} (${G(e)}) only strings can be parsed`);
      let t = e;
      if (t.trim() === 'nan') {
        yield Number.NaN;
        return;
      }
      try {
        yield JSON.parse(t);
      } catch (r) {
        let i =
          r && typeof r == 'object' && 'message' in r
            ? String(r.message)
            : String(r);
        throw new R(i);
      }
    },
    *'gamma/0'(e) {
      yield Qn(I(e));
    },
    *'get_jq_origin/0'() {
      yield 'bxl://jq-origin';
    },
    *'get_prog_origin/0'() {
      yield 'native-inline';
    },
    *'get_search_list/0'() {
      yield [];
    },
    *'getpath/1'(e, t) {
      if (!Pt(t)) throw new D('Expected an array path');
      yield $e(e, t);
    },
    *'gmtime/0'(e) {
      if (b(e) !== 'number') throw new R('gmtime requires numeric inputs');
      yield Mi(e);
    },
    *'halt/0'() {
      Gn(0);
    },
    *'halt_error/1'(e, t) {
      (Xn(Li(e)), Gn(I(t)));
    },
    *'has/1'(e, t) {
      yield pi(e, t);
    },
    *'have_decnum/0'() {
      yield !1;
    },
    *'have_literal_numbers/0'() {
      yield !1;
    },
    *'hypot/1'(e, t) {
      yield Math.hypot(I(e), I(t));
    },
    *'hypot/2'(e, t, n) {
      yield Math.hypot(I(t), I(n));
    },
    *'implode/0'(e) {
      if (b(e) !== 'array') throw new D('Expected an array');
      yield String.fromCodePoint(...e.map((t) => I(t)));
    },
    *'infinite/0'() {
      yield Number.POSITIVE_INFINITY;
    },
    *'input/0'() {
      throw Ce('input/0');
    },
    *'input_filename/0'() {
      throw Ce('input_filename/0');
    },
    *'input_line_number/0'() {
      throw Ce('input_line_number/0');
    },
    *'isinfinite/0'(e) {
      yield b(e) === 'number' && !Number.isFinite(e);
    },
    *'isnan/0'(e) {
      yield b(e) === 'number' && Number.isNaN(e);
    },
    *'isnormal/0'(e) {
      yield b(e) === 'number' &&
        Number.isFinite(e) &&
        e !== 0 &&
        Math.abs(e) >= ta;
    },
    *'j0/0'(e) {
      yield Ht(I(e));
    },
    *'j1/0'(e) {
      yield Wt(I(e));
    },
    *'jn/2'(e, t, n) {
      yield qi(I(t), I(n));
    },
    *'keys/0'(e) {
      yield di(jn(e));
    },
    *'keys_unsorted/0'(e) {
      yield jn(e);
    },
    *'ldexp/2'(e, t, n) {
      yield I(t) * Math.pow(2, Math.trunc(I(n)));
    },
    *'length/0'(e) {
      let t = b(e);
      switch (b(e)) {
        case 'null':
          yield 0;
          break;
        case 'string':
        case 'array':
          yield e.length;
          break;
        case 'object':
          yield Object.keys(e).length;
          break;
        case 'boolean':
        case 'number':
        default:
          throw Error(`${t} has no length`);
      }
    },
    *'lgamma/0'(e) {
      yield er(I(e));
    },
    *'lgamma_r/0'(e) {
      yield er(I(e));
    },
    *'localtime/0'(e) {
      if (b(e) !== 'number') throw new R('localtime requires numeric inputs');
      yield Oi(e);
    },
    *'log/0'(e) {
      yield j(e, 'log', Math.log);
    },
    *'log10/0'(e) {
      yield j(e, 'log10', Math.log10);
    },
    *'log1p/0'(e) {
      yield j(e, 'log1p', Math.log1p);
    },
    *'log2/0'(e) {
      yield j(e, 'log2', Math.log2);
    },
    *'logb/0'(e) {
      yield zi(I(e));
    },
    *'ltrimstr/1'(e, t) {
      let n = J(e),
        r = J(t);
      yield n.startsWith(r) ? n.slice(r.length) : n;
    },
    *'max/0'(e) {
      if (b(e) !== 'array') throw new D('Expected an array');
      if (e.length === 0) {
        yield null;
        return;
      }
      yield e.reduce((t, n) => (M(n, t) > 0 ? n : t));
    },
    *'min/0'(e) {
      if (b(e) !== 'array') throw new D('Expected an array');
      if (e.length === 0) {
        yield null;
        return;
      }
      yield e.reduce((t, n) => (M(n, t) < 0 ? n : t));
    },
    *'mktime/0'(e) {
      if (b(e) !== 'array') throw new R('mktime requires array inputs');
      try {
        yield Bi(e);
      } catch {
        throw new R('mktime requires parsed datetime inputs');
      }
    },
    *'modf/0'(e) {
      let t = I(e),
        n = Math.trunc(t);
      yield [t - n, n];
    },
    *'modulemeta/0'() {
      throw Ce('modulemeta/0');
    },
    *'nan/0'() {
      yield Number.NaN;
    },
    *'nearbyint/0'(e) {
      yield Zn(I(e));
    },
    *'nextafter/2'(e, t, n) {
      yield Fi(I(t), I(n));
    },
    *'nexttoward/2'(e, t, n) {
      yield Fi(I(t), I(n));
    },
    *'not/0'(e) {
      yield !q(e);
    },
    *'now/0'() {
      yield Date.now() / 1e3;
    },
    *'pow/1'(e, t) {
      yield Pi(e, t, Math.pow);
    },
    *'pow/2'(e, t, n) {
      yield Math.pow(I(t), I(n));
    },
    *'pow10/0'(e) {
      yield Math.pow(10, I(e));
    },
    *'range/2'(e, t, n) {
      yield* zn(t, n);
    },
    *'remainder/2'(e, t, n) {
      yield Ui(I(t), I(n));
    },
    *'rint/0'(e) {
      yield Zn(I(e));
    },
    *'round/0'(e) {
      yield Math.round(I(e));
    },
    *'rtrimstr/1'(e, t) {
      let n = J(e),
        r = J(t);
      yield n.endsWith(r) ? n.slice(0, n.length - r.length) : n;
    },
    *'scalars_or_empty/0'(e) {
      aa(e) && (yield e);
    },
    *'scalb/2'(e, t, n) {
      yield I(t) * Math.pow(2, Math.trunc(I(n)));
    },
    *'scalbln/2'(e, t, n) {
      yield I(t) * Math.pow(2, Math.trunc(I(n)));
    },
    *'significand/0'(e) {
      let t = I(e);
      if (t === 0 || !Number.isFinite(t) || Number.isNaN(t)) {
        yield t;
        return;
      }
      yield t / Math.pow(2, zi(t));
    },
    *'sin/0'(e) {
      yield j(e, 'sin', Math.sin);
    },
    *'sinh/0'(e) {
      yield j(e, 'sinh', Math.sinh);
    },
    *'sort/0'(e) {
      yield e.sort(M);
    },
    *'split/1'(e, t) {
      yield J(e).split(J(t));
    },
    *'sqrt/0'(e) {
      yield j(e, 'sqrt', Math.sqrt);
    },
    *'startswith/1'(e, t) {
      let n = J(e),
        r = J(t);
      yield n.startsWith(r);
    },
    *'stderr/0'(e) {
      (Xn(Li(e)), yield e);
    },
    *'strflocaltime/1'(e, t) {
      if (b(t) !== 'string')
        throw new R('strflocaltime/1 requires a string format');
      if (b(e) !== 'number' && b(e) !== 'array')
        throw new R('strflocaltime/1 requires parsed datetime inputs');
      try {
        yield Wn(e, t, 'local');
      } catch {
        throw new R('strflocaltime/1 requires parsed datetime inputs');
      }
    },
    *'strftime/1'(e, t) {
      if (b(t) !== 'string') throw new R('strftime/1 requires a string format');
      if (b(e) !== 'number' && b(e) !== 'array')
        throw new R('strftime/1 requires parsed datetime inputs');
      try {
        yield Wn(e, t, 'utc');
      } catch {
        throw new R('strftime/1 requires parsed datetime inputs');
      }
    },
    *'strptime/1'(e, t) {
      if (b(e) !== 'string' || b(t) !== 'string')
        throw new R('strptime/1 requires string inputs and arguments');
      yield Di(e, t);
    },
    *'toboolean/0'(e) {
      if (b(e) === 'boolean') {
        yield e;
        return;
      }
      if (b(e) === 'string') {
        if (e === 'true') {
          yield !0;
          return;
        }
        if (e === 'false') {
          yield !1;
          return;
        }
      }
      throw new R(`${b(e)} (${G(e)}) cannot be parsed as a boolean`);
    },
    *'tojson/0'(e) {
      let t = JSON.stringify(e);
      if (t === void 0) throw new R('Value cannot be serialized as JSON');
      yield t;
    },
    *'trimstr/1'(e, t) {
      let n = J(e),
        r = J(t),
        i = n.startsWith(r) ? n.slice(r.length) : n;
      yield i.endsWith(r) ? i.slice(0, i.length - r.length) : i;
    },
    *'trim/0'(e) {
      yield Kn(e, 'both');
    },
    *'tan/0'(e) {
      yield j(e, 'tan', Math.tan);
    },
    *'tanh/0'(e) {
      yield j(e, 'tanh', Math.tanh);
    },
    *'tgamma/0'(e) {
      yield Qn(I(e));
    },
    *'tonumber/0'(e) {
      let t = b(e);
      switch (t) {
        case 'string': {
          let n = Number(e);
          if (isNaN(n))
            throw Error(`${t} (${G(e)}) cannot be parsed as number`);
          if (!isFinite(n)) {
            yield n > 0 ? Number.MAX_VALUE : -1 * Number.MAX_VALUE;
            break;
          }
          yield n;
          break;
        }
        case 'number':
          yield e;
          break;
        case 'object':
        case 'array':
        case 'null':
        case 'boolean':
        default:
          throw Error(`${t} (${G(e)}) cannot be parsed as number`);
      }
    },
    *'tostring/0'(e) {
      yield G(e);
    },
    *'utf8bytelength/0'(e) {
      if (b(e) !== 'string')
        throw new R(`${b(e)} (${G(e)}) only strings have UTF-8 byte length`);
      yield new TextEncoder().encode(e).length;
    },
    *'unique/0'(e) {
      if (b(e) !== 'array') throw new D('Expected an array');
      let t = [...e].sort(M),
        n = [];
      for (let r of t)
        (n.length === 0 || M(n[n.length - 1], r) !== 0) && n.push(r);
      yield n;
    },
    *'trunc/0'(e) {
      yield Math.trunc(I(e));
    },
    *'type/0'(e) {
      yield b(e);
    },
    *'ltrim/0'(e) {
      yield Kn(e, 'left');
    },
    *'rtrim/0'(e) {
      yield Kn(e, 'right');
    },
    *'setpath/2'(e, t, n) {
      if (!Pt(t)) throw new D('Expected an array path');
      yield Ie(e, t, n);
    },
    *'y0/0'(e) {
      yield tr(I(e));
    },
    *'y1/0'(e) {
      yield nr(I(e));
    },
    *'yn/2'(e, t, n) {
      yield sa(I(t), I(n));
    },
  }),
};
var ua = new Set(['env/0']),
  la = { jq: Gt, native: rr };
function ca(e, t) {
  return [...new Set([...Object.keys(e), ...Object.keys(t)])]
    .filter((n) => !n.startsWith('_') && !ua.has(n))
    .sort();
}
function ir(e, t) {
  let n = [...new Set(t)],
    r = {},
    i = {};
  for (let s of n) {
    let a = e[s];
    if (!a) throw new Error(`Unknown builtin library: ${s}`);
    (Object.assign(r, a.jq), Object.assign(i, a.native));
  }
  let o = ca(r, i);
  return (
    (i['builtins/0'] = function* () {
      yield E(o);
    }),
    { jq: r, native: i, libraries: n, publicNames: o }
  );
}
var Kt = { core: la },
  Yi = new Map();
function or(e = ['core']) {
  let t = [...new Set(e)],
    n = t.join('\0'),
    r = Yi.get(n);
  return (r || ((r = ir(Kt, t)), Yi.set(n, r)), r);
}
function Hi(e) {
  let t = ai(e) ? ` "${e}"` : '';
  return new R(`${b(e)}${t} is not iterable`);
}
function Wi() {
  return new R('Array slice indices must be numbers');
}
var ht = class extends R {
  constructor(n) {
    super(`Label ${n} is not defined`);
    this.value = n;
  }
};
function sr(e, t) {
  let n = e;
  for (let r of t)
    if (n !== null) {
      if (typeof n == 'object' && !Array.isArray(n)) {
        n = n[r] ?? null;
        continue;
      }
      n = W(n, r);
    }
  return n;
}
function ar(e, t) {
  return e.length === 0 ? t : [...e, ...t];
}
function Te(e) {
  return !!e?.singleOutput;
}
function Ki(e) {
  switch (e) {
    case '==':
    case '!=':
    case '<':
    case '>':
    case '<=':
    case '>=':
    case '+':
    case '-':
    case '*':
    case '/':
    case '%':
      return !0;
    default:
      return !1;
  }
}
function* Ji(e, t, n) {
  let r = new ur(null, n);
  yield* Ye(r.evaluate(e.expr, ot(t)));
}
var ur = class e {
  constructor(t = null, n = t?.builtins ?? or()) {
    this.parent = t;
    this.builtins = n;
    this.vars = Object.create(this.parent ? this.parent.vars : null);
  }
  vars;
  extend() {
    return new e(this, this.builtins);
  }
  getVar(t) {
    if (t in this.vars) return this.vars[t];
    if (t in this.builtins.jq)
      return { scope: null, value: this.builtins.jq[t] };
    if (t in this.builtins.native)
      return { scope: null, value: this.builtins.native[t] };
    throw Bt(t);
  }
  setVar(t, n, r = this) {
    this.vars[t] = { scope: r, value: n };
  }
  getVarValue(t) {
    return this.getVar(t).value;
  }
  evaluateSingle(t, n) {
    switch (t.type) {
      case 'identity':
        return n;
      case 'num':
      case 'bool':
      case 'null':
        return E(t.value);
      case 'str':
        if (!t.interpolated) return E(t.value);
        break;
      case 'format':
        return E(He(t, n.value));
      case 'var':
        return E(this.getVarValue(t.name));
      case 'index':
        if (t.staticPath)
          return E(sr(n.value, t.staticPath), ar(n.path, t.staticPath));
        if (Te(t.expr)) {
          let r = this.evaluateSingle(t.expr, n);
          if (typeof t.index == 'string')
            return E(W(r.value, t.index), [...r.path, t.index]);
          if (Te(t.index)) {
            let i = this.evaluateSingle(t.index, n);
            return E(W(r.value, i.value), [...r.path, i.value]);
          }
        }
        break;
      case 'unary':
        if (t.operator === '-' && Te(t.expr))
          return E(-this.evaluateSingle(t.expr, n).value);
        break;
      case 'binary':
        if (Ki(t.operator) && Te(t.left) && Te(t.right)) {
          let r = this.evaluateSingle(t.right, n),
            i = this.evaluateSingle(t.left, n);
          return E(Be(t.operator, i.value, r.value));
        }
        break;
    }
    throw new Error(`Cannot evaluate ${t.type} as a single-output expression`);
  }
  evaluateFilterArg(t, n) {
    return Te(t)
      ? [this.evaluateSingle(t, n)]
      : Array.from(this.evaluate(t, O(n)));
  }
  *evaluateNativeFilterCall(t, n, r, i) {
    let o = Vt(t);
    if (o) {
      yield* this.evaluateBareNativeFilterCall(o, n, r, i);
      return;
    }
    if (r === 0) {
      for (let u of t(i)) (v(), yield u);
      return;
    }
    let s = E(i.value);
    if (r === 1) {
      let u = this.evaluateFilterArg(n.args[0], s);
      for (let l of u) {
        v();
        for (let c of t(i, l)) (v(), yield c);
      }
      return;
    }
    if (r === 2) {
      let u = this.evaluateFilterArg(n.args[0], s),
        l = this.evaluateFilterArg(n.args[1], s);
      for (let c of u)
        for (let d of l) {
          v();
          for (let p of t(i, c, d)) (v(), yield p);
        }
      return;
    }
    let a = [];
    for (let u = 0; u < r; u++) {
      let l = n.args[u];
      a.push(this.evaluateFilterArg(l, s));
    }
    for (let u of he(a)) {
      v();
      for (let l of t(i, ...u)) (v(), yield l);
    }
  }
  *evaluateBareNativeFilterCall(t, n, r, i) {
    if (r === 0) {
      for (let a of t(i.value)) (v(), yield E(a));
      return;
    }
    let o = E(i.value);
    if (r === 1) {
      let a = this.evaluateFilterArg(n.args[0], o);
      for (let u of a) {
        v();
        for (let l of t(i.value, u.value)) (v(), yield E(l));
      }
      return;
    }
    if (r === 2) {
      let a = this.evaluateFilterArg(n.args[0], o),
        u = this.evaluateFilterArg(n.args[1], o);
      for (let l of a)
        for (let c of u) {
          v();
          for (let d of t(i.value, l.value, c.value)) (v(), yield E(d));
        }
      return;
    }
    let s = [];
    for (let a = 0; a < r; a++) {
      let u = n.args[a];
      s.push(this.evaluateFilterArg(u, o));
    }
    for (let a of he(s)) {
      v();
      for (let u of t(i.value, ...a.map((l) => l.value))) (v(), yield E(u));
    }
  }
  evaluateConditions(t, n) {
    return Array.from(this.evaluate(t, n)).map((r) => q(r.value));
  }
  *evaluateForeach(t, n, r = !1) {
    for (let i of n) {
      v();
      let o = !0,
        s = [];
      for (let a of this.evaluate(t.init, O(i))) {
        v();
        let u = a,
          l = o ? this.evaluate(t.expr, O(i)) : s;
        for (let c of l) {
          v();
          let d = this.extend();
          d.setVar(t.var, c.value);
          let p = !0;
          for (let g of d.evaluate(t.update, O(u)))
            (v(),
              (p = !1),
              (u = g),
              r || (t.extract ? yield* d.evaluate(t.extract, O(g)) : yield g));
          (p && (u = E(null)), o && s.push(c));
        }
        ((o = !1), r && (yield u));
      }
    }
  }
  *evaluate(t, n) {
    if ((v(), t === void 0)) {
      yield* n;
      return;
    }
    switch (t.type) {
      case 'identity':
        yield* n;
        break;
      case 'binary':
        if (t.type === 'binary' && t.operator === '|') {
          yield* this.evaluate(t.right, this.evaluate(t.left, n));
          break;
        }
        if (Ki(t.operator) && Te(t.left) && Te(t.right)) {
          for (let o of n) {
            v();
            let s = this.evaluateSingle(t.right, o),
              a = this.evaluateSingle(t.left, o);
            yield E(Be(t.operator, a.value, s.value));
          }
          break;
        }
        for (let o of n) {
          v();
          let s = this.evaluate(t.left, O(o)),
            a = this.evaluate(t.right, O(o));
          if (ve(t.operator, 4)) (yield* s, yield* a);
          else if (ve(t.operator, 0)) yield* Ai(t.operator, s, a);
          else if (ve(t.operator, 2)) yield* wi(t.operator, s, a);
          else if (ve(t.operator, 5)) yield* Ii(s, a);
          else if (ve(t.operator, 1))
            if (t.operator === '|=') {
              let u = o.value;
              for (let l of st(s)) {
                let c = ut(l, o.path),
                  d;
                for (let p of this.evaluate(t.right, O(E($e(o.value, c))))) {
                  d = we(p.value);
                  break;
                }
                u = Ie(u, c, d);
              }
              yield E(u);
            } else
              t.operator === '='
                ? yield* bi(o, s, a)
                : yield* xi(t.operator, o, s, a);
          else throw new R(`Unexpected operator ${t.operator}`);
        }
        break;
      case 'def': {
        let o = this.extend();
        (o.setVar(t.name, t), yield* o.evaluate(t.next, n));
        break;
      }
      case 'str':
        for (let o of n)
          if ((v(), t.interpolated)) {
            let s = t.parts
              .map((a) =>
                typeof a == 'string'
                  ? [a]
                  : Array.from(this.evaluate(a, O(o))).map((u) =>
                      He(t.format, u.value),
                    ),
              )
              .reverse();
            for (let a of he(s)) (v(), yield E(a.reverse().join('')));
          } else yield E(t.value);
        break;
      case 'num':
      case 'bool':
      case 'null':
        for (let o of n) (v(), yield E(t.value));
        break;
      case 'format':
        for (let o of n) (v(), yield E(He(t, o.value)));
        break;
      case 'filter':
        for (let o of n) {
          v();
          let s = t.arity ?? _e.getFilterArity(t.name),
            a = t.resolvedNative;
          if (a) yield* this.evaluateNativeFilterCall(a, t, s, o);
          else {
            let u = t.resolvedJq
              ? { scope: null, value: t.resolvedJq }
              : this.getVar(t.name);
            if (Ni(u.value)) {
              yield* this.evaluateNativeFilterCall(u.value, t, s, o);
              continue;
            }
            let l = [];
            for (let c = 0; c < s; c++) {
              let d = u.value.args[c],
                p = t.args[c];
              switch (d.type) {
                case 'varArg':
                  l.push(Ae(this.evaluate(p, O(o))));
                  break;
                case 'filterArg':
                  let g = { type: 'def', name: d.name, args: [], body: p };
                  l.push([g]);
                  break;
              }
            }
            for (let c of he(l)) {
              v();
              let d = u.scope?.extend() ?? new e(null, this.builtins);
              for (let p = 0; p < s; p++) {
                let g = u.value.args[p];
                d.setVar(g.name, c[p], this);
              }
              yield* d.evaluate(u.value.body, O(o));
            }
          }
        }
        break;
      case 'if':
        for (let o of n) {
          v();
          let s = [this.evaluateConditions(t.cond, O(o))],
            a = [t.then];
          if (s[0].includes(!1) && t.elifs) {
            for (let d of t.elifs)
              if (
                (s.push(this.evaluateConditions(d.cond, O(o))),
                a.push(d.then),
                !s[s.length - 1].includes(!1))
              )
                break;
          }
          t.else && a.push(t.else);
          let u = [],
            l = (d) =>
              a[d]
                ? (u[d] || (u[d] = Array.from(this.evaluate(a[d], O(o)))), u[d])
                : [];
          function* c(d) {
            if (s[d])
              for (let p of s[d]) (v(), p ? yield* l(d) : yield* c(d + 1));
            else yield* l(d);
          }
          yield* c(0);
        }
        break;
      case 'try':
        for (let o of n) {
          v();
          try {
            for (let s of this.evaluate(t.body, O(o))) (v(), yield s);
          } catch (s) {
            if (s instanceof ht) throw s;
            t.catch && (yield* this.evaluate(t.catch, O(E(s.message))));
          }
        }
        break;
      case 'reduce':
        yield* this.evaluateForeach({ ...t, type: 'foreach' }, n, !0);
        break;
      case 'var':
        for (let o of n) (v(), yield E(this.getVarValue(t.name)));
        break;
      case 'varDeclaration':
        for (let o of n) {
          v();
          for (let s of this.evaluate(t.expr, O(o))) {
            v();
            let a = new Set(e.extractVariableNames(t.destructuring));
            for (let u = 0; u < t.destructuring.length; u++) {
              let l = t.destructuring[u];
              try {
                for (let c of this.destructureValue(s.value, l)) {
                  v();
                  let d = this.extend();
                  for (let p of a) d.setVar(p, null);
                  for (let [p, g] of Object.entries(c)) d.setVar(p, g);
                  yield* d.evaluate(t.next, O(o));
                }
                break;
              } catch (c) {
                if (u + 1 >= t.destructuring.length) throw c;
              }
            }
          }
        }
        break;
      case 'foreach':
        yield* this.evaluateForeach(t, n);
        break;
      case 'label':
        try {
          yield* this.evaluate(t.next, n);
        } catch (o) {
          if (o instanceof ht) {
            if (o.value !== t.value) throw o;
            break;
          } else throw o;
        }
        break;
      case 'break':
        throw new ht(t.value);
      case 'unary':
        let { operator: r, type: i } = t;
        if (t.operator === '-') {
          for (let o of n) {
            v();
            for (let s of this.evaluate(t.expr, O(o))) (v(), yield E(-s.value));
          }
          break;
        }
        throw Ce(`${i}:${r}`);
      case 'index':
        if (t.staticPath) {
          for (let o of n)
            (v(), yield E(sr(o.value, t.staticPath), ar(o.path, t.staticPath)));
          break;
        }
        for (let o of n) {
          v();
          for (let s of this.evaluate(t.expr, O(o)))
            if ((v(), typeof t.index == 'string'))
              yield E(W(s.value, t.index), [...s.path, t.index]);
            else
              for (let a of this.evaluate(t.index, O(o)))
                (v(), yield E(W(s.value, a.value), [...s.path, a.value]));
        }
        break;
      case 'slice':
        for (let o of n) {
          v();
          let s = t.from ? Array.from(this.evaluate(t.from, O(o))) : [void 0],
            a = t.to ? Array.from(this.evaluate(t.to, O(o))) : [void 0];
          for (let u of this.evaluate(t.expr, O(o))) {
            if ((v(), !qe(u.value, 'array', 'string', 'null')))
              throw Dt(u.value);
            for (let l of s) {
              if ((v(), l !== void 0 && b(l.value) !== 'number')) throw Wi();
              for (let c of a) {
                if ((v(), c !== void 0 && b(c.value) !== 'number')) throw Wi();
                let d = si(l?.value ?? null, c?.value ?? null);
                yield E(W(u.value, d), [...u.path, d]);
              }
            }
          }
        }
        break;
      case 'iterator':
        if (t.expr.type === 'index' && t.expr.staticPath) {
          for (let o of n) {
            v();
            let s = sr(o.value, t.expr.staticPath),
              a = ar(o.path, t.expr.staticPath);
            switch (b(s)) {
              case 'array':
                for (let u = 0; u < s.length; u++)
                  (v(), yield E(s[u], [...a, u]));
                break;
              case 'object':
                for (let [u, l] of Object.entries(s))
                  (v(), yield E(l, [...a, u]));
                break;
              case 'null':
                break;
              default:
                throw Hi(s);
            }
          }
          break;
        }
        for (let o of n) {
          v();
          for (let s of this.evaluate(t.expr, O(o)))
            switch ((v(), b(s.value))) {
              case 'array':
                for (let a = 0; a < s.value.length; a++)
                  (v(), yield E(s.value[a], [...s.path, a]));
                break;
              case 'object':
                for (let [a, u] of Object.entries(s.value))
                  (v(), yield E(u, [...s.path, a]));
                break;
              case 'null':
                break;
              default:
                throw Hi(s.value);
            }
        }
        break;
      case 'array':
        for (let o of n)
          (v(),
            t.expr ? yield E(Ae(this.evaluate(t.expr, O(o)))) : yield E([]));
        break;
      case 'object':
        for (let o of n)
          (v(),
            yield* ot(
              vi(
                t.entries.map(({ key: s, value: a }) => [
                  typeof s == 'string' ? [s] : Ae(this.evaluate(s, O(o))),
                  a === void 0 ? [o.value[s]] : Ae(this.evaluate(a, O(o))),
                ]),
              ),
            ));
        break;
      case 'recursiveDescent':
        for (let o of n) {
          v();
          for (let s of Lt(o.value)) (v(), yield E(s));
        }
        break;
    }
  }
  static *extractVariableNames(t) {
    for (let n of t)
      switch (n.type) {
        case 'var':
          yield n.name;
          break;
        case 'arrayDestructuring': {
          for (let r of n.destructuring) yield* e.extractVariableNames([r]);
          break;
        }
        case 'objectDestructuring':
          for (let r of n.entries)
            r.destructuring
              ? yield* e.extractVariableNames([r.destructuring])
              : yield r.key.name;
          break;
      }
  }
  *destructureValue(t, n) {
    switch (n.type) {
      case 'var':
        yield { [n.name]: t };
        break;
      case 'arrayDestructuring': {
        if (b(t) !== 'array')
          throw new R(`${b(t)} cannot be destructured as an array`);
        let i = n.destructuring.map((o, s) =>
          Array.from(this.destructureValue(t[s], n.destructuring[s])),
        );
        for (let o of he(i)) yield Object.assign({}, ...o);
        break;
      }
      case 'objectDestructuring':
        if (b(t) !== 'object')
          throw new R(`${b(t)} cannot be destructured as an object`);
        let r = n.entries.map((i) => {
          if (i.destructuring)
            return typeof i.key == 'string'
              ? Array.from(this.destructureValue(t[i.key], i.destructuring))
              : Ae(this.evaluate(i.key, O(E(t))))
                  .map((s) =>
                    Array.from(this.destructureValue(t[s], i.destructuring)),
                  )
                  .flat();
          {
            let o = i.key.name,
              s = i.key.name.substring(1),
              a = t[s];
            return [{ [o]: a }];
          }
        });
        for (let i of he(r)) yield Object.assign({}, ...i.reverse());
        break;
    }
  }
};
Q();
De();
te();
var pa = new Set([
  'ABS/1',
  'DATE/3',
  'DATEDIF/3',
  'DATEVALUE/1',
  'DAY/1',
  'DAYS360/2',
  'DAYS360/3',
  'MONTH/1',
  'NETWORKDAYS/2',
  'NETWORKDAYS/3',
  'ROUND/1',
  'ROUND/2',
  'ROUNDDOWN/1',
  'ROUNDDOWN/2',
  'ROUNDUP/1',
  'ROUNDUP/2',
  'WEEKNUM/1',
  'WEEKNUM/2',
  'WORKDAY/2',
  'WORKDAY/3',
  'YEAR/1',
  'YEARFRAC/2',
  'YEARFRAC/3',
  'ceil/0',
  'floor/0',
  'length/0',
  'round/0',
  'sort/0',
  'sqrt/0',
  'tostring/0',
]);
function da(e) {
  switch (e) {
    case '==':
    case '!=':
    case '<':
    case '>':
    case '<=':
    case '>=':
    case '+':
    case '-':
    case '*':
    case '/':
    case '%':
      return !0;
    default:
      return !1;
  }
}
function fa(e, t) {
  let n = e;
  for (let r of t)
    if (n !== null) {
      if (typeof n == 'object' && !Array.isArray(n)) {
        n = n[r] ?? null;
        continue;
      }
      n = W(n, r);
    }
  return n;
}
function ma(e) {
  let t = Y(e[0]),
    n = Y(e[1]),
    r = e[2] ? Y(e[2]) : () => !1;
  if (!(!t || !n || !r)) return (i) => (q(t(i)) ? n(i) : r(i));
}
function ha(e) {
  if (e.length < 2 || e.length % 2 !== 0) return;
  let t = [];
  for (let n = 0; n < e.length; n += 2) {
    let r = Y(e[n]),
      i = Y(e[n + 1]);
    if (!r || !i) return;
    t.push([r, i]);
  }
  return (n) => {
    for (let [r, i] of t) if (q(r(n))) return i(n);
    throw new R('#N/A');
  };
}
function ya(e) {
  if (!pa.has(e.name)) return;
  let t = e.resolvedNative;
  if (typeof t != 'function') return;
  let n = Vt(t);
  if (!n) return;
  let r = [];
  for (let i of e.args) {
    let o = Y(i);
    if (!o) return;
    r.push(o);
  }
  return (i) => {
    let s = n(i, ...r.map((a) => a(i))).next();
    return s.done ? void 0 : s.value;
  };
}
function Y(e) {
  if (e)
    switch (e.type) {
      case 'identity':
        return (t) => t;
      case 'num':
      case 'bool':
      case 'null':
        return () => e.value;
      case 'str':
        return e.interpolated ? void 0 : () => e.value;
      case 'format':
        return (t) => He(e, t);
      case 'index': {
        if (e.staticPath) {
          let r = e.staticPath;
          return (i) => fa(i, r);
        }
        let t = Y(e.expr);
        if (!t) return;
        if (typeof e.index == 'string') {
          let r = e.index;
          return (i) => W(t(i), r);
        }
        let n = Y(e.index);
        return n ? (r) => W(t(r), n(r)) : void 0;
      }
      case 'unary': {
        if (e.operator !== '-') return;
        let t = Y(e.expr);
        return t ? (n) => -t(n) : void 0;
      }
      case 'filter':
        return e.name === 'IF/2' || e.name === 'IF/3'
          ? ma(e.args)
          : e.name.startsWith('IFS/')
            ? ha(e.args)
            : ya(e);
      case 'binary': {
        let t = e.operator;
        if (t === '|') {
          let i = Y(e.left),
            o = Y(e.right);
          return !i || !o ? void 0 : (s) => o(i(s));
        }
        if (t === 'and' || t === 'or') {
          let i = Y(e.left),
            o = Y(e.right);
          return !i || !o
            ? void 0
            : t === 'and'
              ? (s) => (q(i(s)) ? q(o(s)) : !1)
              : (s) => (q(i(s)) ? !0 : q(o(s)));
        }
        if (!da(t)) return;
        let n = Y(e.left),
          r = Y(e.right);
        return !n || !r ? void 0 : (i) => Be(t, n(i), r(i));
      }
      default:
        return;
    }
}
var Zi = Xt(`
def TRUE: true;
def FALSE: false;
def NA: "#N/A" | error;
def INDEX(array; row): _EXCEL_INDEX(array; row);
def INDEX(array; row; column): _EXCEL_INDEX(array; row; column);
def IF(test; value_if_true; value_if_false):
  . as $xl_in
  | if ($xl_in | test)
      then ($xl_in | value_if_true)
      else ($xl_in | value_if_false)
    end;
def IF(test; value_if_true): IF(test; value_if_true; false);
def IFERROR(value; value_if_error):
  . as $xl_in
  | try ($xl_in | value) catch ($xl_in | value_if_error);
def IFNA(value; value_if_na):
  . as $xl_in
  | try ($xl_in | value)
    catch if . == "#N/A" then ($xl_in | value_if_na) else error end;
def ISERROR(value):
  try (. as $xl_in | $xl_in | value | false) catch true;
def ISNA(value):
  try (. as $xl_in | $xl_in | value | false) catch (. == "#N/A");
def ISERR(value):
  try (. as $xl_in | $xl_in | value | false) catch (. != "#N/A");
def ERROR_TYPE(value):
  (
    try (. as $xl_in | $xl_in | value | "__XL_NO_ERROR__")
    catch (
      if . == "#NULL!" then 1
      elif . == "#DIV/0!" then 2
      elif . == "#VALUE!" then 3
      elif . == "#REF!" then 4
      elif . == "#NAME?" then 5
      elif . == "#NUM!" then 6
      elif . == "#N/A" then 7
      elif . == "#GETTING_DATA" then 8
      else NA end
    )
  )
  | if . == "__XL_NO_ERROR__" then NA else . end;
def IFS(c1; v1; c2; v2):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) else NA end;
def IFS(c1; v1; c2; v2; c3; v3):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) elif ($in | c3) then ($in | v3) else NA end;
def IFS(c1; v1; c2; v2; c3; v3; c4; v4):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) elif ($in | c3) then ($in | v3) elif ($in | c4) then ($in | v4) else NA end;
def IFS(c1; v1; c2; v2; c3; v3; c4; v4; c5; v5):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) elif ($in | c3) then ($in | v3) elif ($in | c4) then ($in | v4) elif ($in | c5) then ($in | v5) else NA end;
def IFS(c1; v1; c2; v2; c3; v3; c4; v4; c5; v5; c6; v6):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) elif ($in | c3) then ($in | v3) elif ($in | c4) then ($in | v4) elif ($in | c5) then ($in | v5) elif ($in | c6) then ($in | v6) else NA end;
def IFS(c1; v1; c2; v2; c3; v3; c4; v4; c5; v5; c6; v6; c7; v7):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) elif ($in | c3) then ($in | v3) elif ($in | c4) then ($in | v4) elif ($in | c5) then ($in | v5) elif ($in | c6) then ($in | v6) elif ($in | c7) then ($in | v7) else NA end;
def IFS(c1; v1; c2; v2; c3; v3; c4; v4; c5; v5; c6; v6; c7; v7; c8; v8):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) elif ($in | c3) then ($in | v3) elif ($in | c4) then ($in | v4) elif ($in | c5) then ($in | v5) elif ($in | c6) then ($in | v6) elif ($in | c7) then ($in | v7) elif ($in | c8) then ($in | v8) else NA end;

# BXL-native helpers (lowercase) + Excel helpers not yet expressed in jq.
# ISBLANK is defined as a native filter elsewhere with Excel-strict
# semantics (null only, NOT empty string). present(x) below is the
# looser, form-friendly positive form that treats "" as absent too.
def present(x):
  . as $in | [($in | x)][0] as $v | ($v != null) and ($v != "");

# when(p; q): conditional-requirement / implication.
# Reads "when p, require q" and vacuously passes when p is false.
# Excel shape is IF(p, q, TRUE); when(p; q) is the BXL shortcut.
def when(p; q):
  . as $in | if ($in | p) then ($in | q) else true end;

def implies(p; q): when(p; q);

# words(s): count whitespace-separated non-empty tokens. Excel has no
# direct equivalent; handles null gracefully and ignores double-spaces.
def words(s):
  . as $in | ($in | s) as $v
  | (($v // "") | split(" ") | map(select(. != "")) | length);

# nonempty(arr): strip nulls and empty strings from an array.
def nonempty(arr):
  . as $in | ($in | arr) | map(select(. != null and . != ""));

# overlaps(arr): true when the input array and arr share at least one value.
# This is the in-memory mirror of the predicate-profile SQL overlap operator.
def overlaps(arr):
  . as $left
  | arr as $right
  | if (($left | type) != "array") or (($right | type) != "array") then false
    else any($left[]; . as $item | any($right[]; . == $item))
    end;
`);
bt();
bt();
function ba(e) {
  if (/^-?\d+(\.\d+)?$/.test(e))
    return e.includes('.') ? parseFloat(e) : parseInt(e, 10);
  let t = e.toUpperCase();
  return t === 'TRUE' ? !0 : t === 'FALSE' ? !1 : e;
}
function xa(e) {
  let t = !1;
  for (let n of e) {
    if (t) {
      t = !1;
      continue;
    }
    if (n === '~') {
      t = !0;
      continue;
    }
    if (n === '*' || n === '?') return !0;
  }
  return !1;
}
function wa(e) {
  let t = !1,
    n = '^';
  for (let r of e) {
    if (t) {
      ((n += r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), (t = !1));
      continue;
    }
    if (r === '~') {
      t = !0;
      continue;
    }
    if (r === '*') {
      n += '.*';
      continue;
    }
    if (r === '?') {
      n += '.';
      continue;
    }
    n += r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return ((n += '$'), new RegExp(n, 'i'));
}
function dr(e) {
  return typeof e == 'string'
    ? e
    : typeof e == 'boolean'
      ? e
        ? 'TRUE'
        : 'FALSE'
      : yt(e)
        ? ''
        : String(e);
}
function Aa(e, t, n) {
  let r = e.toLowerCase(),
    i = t.toLowerCase(),
    o = r.localeCompare(i);
  switch (n) {
    case '>':
      return o > 0;
    case '>=':
      return o >= 0;
    case '<':
      return o < 0;
    case '<=':
      return o <= 0;
    case '=':
      return o === 0;
    case '<>':
      return o !== 0;
    default:
      return !1;
  }
}
function io(e, t, n) {
  if (typeof t == 'string' && (n === '=' || n === '<>')) {
    if (t === '') {
      let r = yt(e);
      return n === '=' ? r : !r;
    }
    if (xa(t)) {
      let r = wa(t).test(dr(e));
      return n === '=' ? r : !r;
    }
  }
  if (typeof e == 'string' || typeof t == 'string') return Aa(dr(e), dr(t), n);
  switch (n) {
    case '>':
      return e > t;
    case '>=':
      return e >= t;
    case '<':
      return e < t;
    case '<=':
      return e <= t;
    case '=':
      return e == t;
    case '<>':
      return e != t;
    default:
      return !1;
  }
}
function Le(e) {
  if (e === void 0) return () => !0;
  if (typeof e == 'string') {
    let t = e.match(/^(>=|<=|<>|>|<|=)?(.*)$/),
      n = t?.[1] ?? '=',
      r = ba(t?.[2] ?? e);
    return (i) => io(i, r, n);
  }
  return (t) => io(t, e, '=');
}
function oo(e, t) {
  return Le(t)(e);
}
Jt();
it();
De();
yo();
bt();
De();
var Sa = {
    *'DATE/3'(e, t, n, r) {
      yield so(f(t), f(n), f(r));
    },
    *'DATEDIF/3'(e, t, n, r) {
      yield co(t, n, r);
    },
    *'DATEVALUE/1'(e, t) {
      yield po(t);
    },
    *'DAY/1'(e, t) {
      yield lo(t);
    },
    *'DAYS360/2'(e, t, n) {
      yield hr(t, n);
    },
    *'DAYS360/3'(e, t, n, r) {
      yield hr(t, n, r);
    },
    *'MONTH/1'(e, t) {
      yield uo(t);
    },
    *'NETWORKDAYS_INTL/2'(e, t, n) {
      yield tn(t, n);
    },
    *'NETWORKDAYS_INTL/3'(e, t, n, r) {
      yield tn(t, n, r);
    },
    *'NETWORKDAYS_INTL/4'(e, t, n, r, i) {
      yield tn(t, n, r, i);
    },
    *'NETWORKDAYS/2'(e, t, n) {
      yield gr(t, n);
    },
    *'NETWORKDAYS/3'(e, t, n, r) {
      yield gr(t, n, r);
    },
    *'WEEKNUM/1'(e, t) {
      yield yr(t);
    },
    *'WEEKNUM/2'(e, t, n) {
      yield yr(t, n);
    },
    *'WORKDAY_INTL/2'(e, t, n) {
      yield nn(t, n);
    },
    *'WORKDAY_INTL/3'(e, t, n, r) {
      yield nn(t, n, r);
    },
    *'WORKDAY_INTL/4'(e, t, n, r, i) {
      yield nn(t, n, r, i);
    },
    *'WORKDAY/2'(e, t, n) {
      yield br(t, n);
    },
    *'WORKDAY/3'(e, t, n, r) {
      yield br(t, n, r);
    },
    *'YEAR/1'(e, t) {
      yield ao(t);
    },
    *'YEARFRAC/2'(e, t, n) {
      yield mr(t, n);
    },
    *'YEARFRAC/3'(e, t, n, r) {
      yield mr(t, n, f(r));
    },
  },
  go = Re(Sa);
function Ta(e) {
  return !e || typeof e != 'object' || Array.isArray(e) ? {} : e;
}
function Tr(e) {
  return (Array.isArray(e) || y(h.value), e.map((t) => Ta(t)));
}
function Na(e) {
  return ((!e || typeof e != 'object' || Array.isArray(e)) && y(h.value), e);
}
function de(e, t) {
  let n = Tr(e),
    r = k(t);
  return n.map((i) =>
    Object.prototype.hasOwnProperty.call(i, r) ? i[r] : null,
  );
}
function xr(e, t) {
  let n = Tr(e),
    r = Na(t);
  return n.filter((i) =>
    Object.entries(r).every(([o, s]) => oo(i[o] ?? null, s)),
  );
}
function Fe(e, t, n) {
  let r = f(e),
    i = f(t),
    o = r >= 0 ? 1 : -1,
    a = `${Math.abs(r)}e${i}`.split('e');
  return (
    (a = `${n(+`${a[0]}e${a[1]}`)}e${-i}`.split('e')),
    +`${a[0]}e${a[1]}` * o
  );
}
function rn(e, t = 1) {
  let n = f(e),
    r = Math.abs(f(t));
  return r === 0 ? 0 : Math.ceil(n / r) * r;
}
function on(e, t = 1) {
  let n = f(e),
    r = Math.abs(f(t));
  return r === 0 ? 0 : Math.floor(n / r) * r;
}
function P(e) {
  return ((!Number.isFinite(e) || Number.isNaN(e)) && y(h.num), e);
}
function bo(e) {
  let t = Math.floor(f(e));
  t < 0 && y(h.num);
  let n = 1;
  for (let r = 2; r <= t; r++) ((n *= r), P(n));
  return n;
}
function wr(e, t = 10) {
  let n = f(e),
    r = f(t);
  return (
    (n <= 0 || r <= 0 || r === 1) && y(h.num),
    P(r === 10 ? Math.log10(n) : Math.log(n) / Math.log(r))
  );
}
function xo(e, t = 0) {
  let n = f(e),
    i = 10 ** Math.trunc(f(t));
  return ((n < 0 ? -1 : 1) * Math.floor(Math.abs(n) * i)) / i;
}
function Ea(e) {
  let t = ye(e),
    n = t.reduce((i, o) => i + Math.floor(o), 0),
    r = t.reduce((i, o) => i * bo(o), 1);
  return P(bo(n) / r);
}
function ka(e, t, n, r) {
  let i = f(e),
    o = f(t),
    s = f(n),
    a = ye(r);
  return P(a.reduce((u, l, c) => u + l * i ** (o + c * s), 0));
}
function Ar(e, t, n) {
  let r = ye(e),
    i = ye(t);
  return (
    r.length !== i.length && y(h.value),
    P(r.reduce((o, s, a) => o + n(s, i[a]), 0))
  );
}
var _a = 864e5,
  Ca = Date.UTC(1900, 0, 1),
  $a = Date.UTC(1900, 1, 28);
function Ma() {
  let e = new Date(),
    t = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate())),
    n =
      e.getUTCHours() * 3600 +
      e.getUTCMinutes() * 60 +
      e.getUTCSeconds() +
      e.getUTCMilliseconds() / 1e3,
    r = t.getTime() > $a ? 2 : 1;
  return Math.ceil((t.getTime() - Ca) / _a) + r + n / 86400;
}
function Oa(e, t, n, r) {
  let i = 0,
    o = 0;
  for (; i > -1 && e.indexOf(t, i) > -1; )
    if (((i = e.indexOf(t, i + 1)), o++, i > -1 && o === r))
      return e.slice(0, i) + n + e.slice(i + t.length);
  return e;
}
function ln(e) {
  return e == null
    ? ''
    : typeof e == 'boolean'
      ? e
        ? 'TRUE'
        : 'FALSE'
      : String(e);
}
function Ba(e) {
  if (typeof e == 'number') return e;
  let t = e;
  (t == null && (t = ''), typeof t != 'string' && y(h.value));
  let n = /(%)$/.test(t) || /^(%)/.test(t),
    r = t.replace(/^[^0-9-]{0,3}/, '');
  if (
    ((r = r.replace(/[^0-9]{0,3}$/, '')),
    (r = r.replace(/[ ,]/g, '')),
    r === '')
  ) {
    if (t.trim() === '') return 0;
    y(h.value);
  }
  let i = Number(r);
  return (Number.isNaN(i) && y(h.value), n ? i * 0.01 : i);
}
function Da(e, t) {
  if (e instanceof Date) return e.toISOString().slice(0, 10);
  if (t == null) return '';
  if (typeof t == 'number') return String(t);
  typeof t != 'string' && y(h.value);
  let n = t.startsWith('$') ? '$' : '',
    r = t.endsWith('%'),
    i = t.replace(/%/g, '').replace(/\$/g, ''),
    o = i.includes('.') ? (i.split('.')[1].match(/0/g) ?? []).length : 0,
    s = !i.includes(','),
    a = f(e);
  r && (a *= 100);
  let u = un(a, o, s);
  return (
    u.startsWith('-') ? (u = `-${n}${u.slice(1)}`) : (u = `${n}${u}`),
    r && (u += '%'),
    u
  );
}
function un(e, t = 2, n = !1) {
  let r = f(e),
    i = f(t),
    o = Zt(n);
  if (i < 0) {
    let u = Math.pow(10, -i);
    r = Math.round(r / u) * u;
  } else r = Number(r.toFixed(i));
  let s = i < 0 ? String(r) : r.toFixed(i);
  if (o) return s.replace(/,/g, '');
  let a = s.split('.');
  return (
    (a[0] = a[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')),
    (s = a.join('.')),
    r < 0,
    s
  );
}
function wo(e, t = 2) {
  let n = f(e),
    r = f(t);
  n = Fe(n, r, Math.round);
  let i = {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: r >= 0 ? r : 0,
      maximumFractionDigits: r >= 0 ? r : 0,
    },
    o = n.toLocaleString('en-US', i);
  return n < 0 ? `(${o.slice(1)})` : o;
}
function Ir(e, t, n) {
  let r = e ?? '';
  if (typeof r == 'number') return r;
  typeof r != 'string' && y(h.na);
  let i = t === void 0 ? '.' : k(t),
    o = n === void 0 ? ',' : k(n);
  i === o && y(h.value);
  let s = Number(r.split(o).join('').replace(i, '.'));
  return (Number.isNaN(s) && y(h.value), s);
}
var La = {
  M: 1e3,
  CM: 900,
  D: 500,
  CD: 400,
  C: 100,
  XC: 90,
  L: 50,
  XL: 40,
  X: 10,
  IX: 9,
  V: 5,
  IV: 4,
  I: 1,
};
function Pa(e) {
  let t = k(e);
  /^M*(?:D?C{0,3}|C[MD])(?:L?X{0,3}|X[CL])(?:V?I{0,3}|I[XV])$/.test(t) ||
    y(h.value);
  let n = 0;
  return (
    t.replace(/[MDLV]|C[MD]?|X[CL]?|I[XV]?/g, (r) => ((n += La[r] ?? 0), r)),
    n
  );
}
function Fa(e) {
  let t = Math.floor(f(e));
  t < 0 && y(h.value);
  let n = String(t).split(''),
    r = [
      '',
      'C',
      'CC',
      'CCC',
      'CD',
      'D',
      'DC',
      'DCC',
      'DCCC',
      'CM',
      '',
      'X',
      'XX',
      'XXX',
      'XL',
      'L',
      'LX',
      'LXX',
      'LXXX',
      'XC',
      '',
      'I',
      'II',
      'III',
      'IV',
      'V',
      'VI',
      'VII',
      'VIII',
      'IX',
    ],
    i = '',
    o = 3;
  for (; o--; ) i = (r[Number(n.pop()) + o * 10] ?? '') + i;
  return `${'M'.repeat(Number(n.join('')))}${i}`;
}
function Ua(e) {
  return k(e).replace(
    /\w\S*/g,
    (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(),
  );
}
function za(e, t, n) {
  let r =
      e == null
        ? ''
        : Array.isArray(e)
          ? N(e)
              .map((s) => ln(s))
              .join('')
          : String(e),
    i = Zt(t);
  return N(n)
    .filter((s) => !i || !yt(s))
    .map((s) => ln(s))
    .join(r);
}
function ja(e) {
  let t = null;
  for (let n of N(e))
    if (!(n == null || typeof n == 'string')) {
      if ((t === null && (t = !1), !n)) return !1;
      t = !0;
    }
  return (t === null && y(h.value), t);
}
function Va(e) {
  let t = !1;
  for (let n of N(e))
    if (!(n == null || typeof n == 'string') && ((t = !0), n)) return !0;
  return (t || y(h.value), !1);
}
function Xa(e) {
  let t = 0,
    n = !1;
  for (let r of N(e)) r == null || typeof r == 'string' || ((n = !0), r && t++);
  return (n || y(h.value), !!(Math.floor(Math.abs(t)) & 1));
}
function Ao(e, t) {
  let n = N(e),
    r = Le(t);
  return n.reduce((i, o) => i + (r(o) ? 1 : 0), 0);
}
function vr(e, t, n) {
  let r = N(e),
    i = N(n ?? e),
    o = Le(t),
    s = 0;
  for (let a = 0; a < r.length; a++) o(r[a]) && (s += f(i[a] ?? 0));
  return s;
}
function Rr(e, t, n) {
  let r = N(e),
    i = N(n ?? e),
    o = Le(t),
    s = 0,
    a = 0;
  for (let u = 0; u < r.length; u++) o(r[u]) && ((s += f(i[u] ?? 0)), a++);
  return (a === 0 && y(h.div0), s / a);
}
function Ga(e, t) {
  let n = Math.trunc(f(e)),
    r = Array.isArray(t) ? t : [t];
  return ((n < 1 || n > r.length) && y(h.value), r[n - 1]);
}
function Io(e, t, n = 1) {
  let r = N(t),
    i = f(n);
  [1, 0, -1].includes(i) || y(h.na);
  let o, s;
  for (let a = 0; a < r.length; a++) {
    let u = r[a];
    if (i === 1) {
      if (u === e) return a + 1;
      u < e && (s === void 0 || u > s) && ((o = a + 1), (s = u));
    } else if (i === 0) {
      if (typeof e == 'string' && typeof u == 'string') {
        let l = e
          .toLowerCase()
          .replace(/\?/g, '.')
          .replace(/\*/g, '.*')
          .replace(/~/g, '\\')
          .replace(/\+/g, '\\+')
          .replace(/\(/g, '\\(')
          .replace(/\)/g, '\\)')
          .replace(/\[/g, '\\[')
          .replace(/\]/g, '\\]');
        if (new RegExp(`^${l}$`).test(u.toLowerCase())) return a + 1;
      } else if (u === e) return a + 1;
    } else if (i === -1) {
      if (u === e) return a + 1;
      u > e && (s === void 0 || u < s) && ((o = a + 1), (s = u));
    }
  }
  return (o === void 0 && y(h.na), o);
}
function So(e) {
  return (
    Array.isArray(e) || y(h.value),
    e.map((t) => (Array.isArray(t) ? t : [t]))
  );
}
function vo(e) {
  let t = So(e),
    n = t.reduce((r, i) => Math.max(r, i.length), 0);
  return Array.from({ length: n }, (r, i) => t.map((o) => o[i]));
}
function sn(e, t, n) {
  Array.isArray(e) || y(h.value);
  let r = f(t),
    i = n === void 0 ? void 0 : f(n),
    o = e.length > 0 && !Array.isArray(e[0]);
  if (
    (o && i === void 0 ? ((i = r), (r = 1)) : ((r = r || 1), (i = i || 1)),
    (r < 0 || (i ?? 0) < 0) && y(h.value),
    o)
  ) {
    let a = e;
    if (r === 1 && (i ?? 0) <= a.length) return a[(i ?? 1) - 1];
    y(h.ref);
  }
  let s = e;
  if (r <= s.length && (i ?? 0) <= s[r - 1].length)
    return s[r - 1][(i ?? 1) - 1];
  y(h.ref);
}
function Sr(e, t, n) {
  let r = N(t),
    i = n === void 0 ? r : N(n),
    o = typeof e == 'number',
    s,
    a = !1;
  for (let u = 0; u < r.length; u++) {
    let l = r[u];
    if (l === e) return i[u];
    if (
      (o && typeof l == 'number' && l <= e) ||
      (typeof l == 'string' && typeof e == 'string' && l.localeCompare(e) < 0)
    ) {
      ((s = i[u]), (a = !0));
      continue;
    }
    if (o && typeof l == 'number' && l > e) {
      if (a) return s;
      break;
    }
  }
  return (a || y(h.na), s);
}
function an(e, t, n, r = void 0, i = 0, o = 1) {
  let s = N(t),
    a = N(n),
    u = f(i),
    l = f(o);
  (![0, -1, 1].includes(u) || ![1, -1].includes(l)) && y(h.value);
  let c = s.map((d, p) => p);
  l === -1 && c.reverse();
  for (let d of c) if (s[d] === e) return a[d] ?? null;
  if (u !== 0) {
    let d;
    for (let p of c) {
      let g = s[p];
      if (
        (typeof g == 'number' &&
          typeof e == 'number' &&
          ((u === -1 && g < e) || (u === 1 && g > e)) &&
          (d === void 0 || (u === -1 && g > s[d]) || (u === 1 && g < s[d])) &&
          (d = p),
        typeof g == 'string' && typeof e == 'string')
      ) {
        let x = g.localeCompare(e);
        ((u === -1 && x < 0) || (u === 1 && x > 0)) &&
          (d === void 0 ||
            (u === -1 && g.localeCompare(String(s[d])) > 0) ||
            (u === 1 && g.localeCompare(String(s[d])) < 0)) &&
          (d = p);
      }
    }
    if (d !== void 0) return a[d] ?? null;
  }
  if (r !== void 0) return r;
  y(h.na);
}
function xt(e, t, n, r) {
  t || y(h.na);
  let i = f(n);
  (i || y(h.na), i < 1 && y(h.value));
  let o = So(t),
    s = r === void 0 ? !0 : Zt(r),
    a = typeof e == 'string' ? e.toLowerCase() : e,
    u = typeof e == 'number',
    l,
    c = !1,
    d = !1;
  for (let p of o) {
    let g = typeof p[0] == 'string' ? p[0].toLowerCase() : p[0];
    if (g === a) return (i > p.length && y(h.ref), p[i - 1]);
    (!d &&
      s &&
      ((u && typeof g == 'number' && g <= e) ||
        (typeof g == 'string' &&
          typeof a == 'string' &&
          g.localeCompare(a) < 0)) &&
      (i > p.length && y(h.ref), (l = p[i - 1]), (c = !0)),
      u && typeof g == 'number' && g > e && (d = !0));
  }
  return (c || y(h.na), l);
}
function qa(e, t, n, r) {
  return Sr(n, de(e, t), de(e, r));
}
function Ro(e, t, n, r, i = !1) {
  let o = k(t),
    s = k(r),
    u = Tr(e).map((l) => [l[o] ?? null, l[s] ?? null]);
  return xt(n, u, 2, i);
}
function Ya(e, t) {
  let n = k(e),
    r = k(t),
    i = '^';
  for (let o of r)
    o === '%'
      ? (i += '.*')
      : o === '_'
        ? (i += '.')
        : (i += o.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'));
  return ((i += '$'), new RegExp(i, 's').test(n));
}
function Ha(e, t, n) {
  return M(e, t) >= 0 && M(e, n) <= 0;
}
var Wa = {
    *'between/3'(e, t, n, r) {
      yield Ha(t, n, r);
    },
    *'like/2'(e, t, n) {
      yield Ya(t, n);
    },
    *'ABS/1'(e, t) {
      yield Math.abs(f(t));
    },
    *'ACOS/1'(e, t) {
      yield P(Math.acos(f(t)));
    },
    *'ACOSH/1'(e, t) {
      yield P(Math.acosh(f(t)));
    },
    *'ACOT/1'(e, t) {
      let n = f(t),
        r = Math.atan(1 / n);
      yield P(n < 0 ? r + Math.PI : r);
    },
    *'ACOTH/1'(e, t) {
      let n = f(t);
      (Math.abs(n) <= 1 && y(h.num),
        yield P(0.5 * Math.log((n + 1) / (n - 1))));
    },
    *'AND/1'(e, t) {
      yield ja(t);
    },
    *'ARABIC/1'(e, t) {
      yield Pa(t);
    },
    *'ASIN/1'(e, t) {
      yield P(Math.asin(f(t)));
    },
    *'ASINH/1'(e, t) {
      yield P(Math.asinh(f(t)));
    },
    *'ATAN/1'(e, t) {
      yield Math.atan(f(t));
    },
    *'ATAN2/2'(e, t, n) {
      let r = f(t),
        i = f(n);
      (r === 0 && i === 0 && y(h.div0), yield P(Math.atan2(i, r)));
    },
    *'ATANH/1'(e, t) {
      yield P(Math.atanh(f(t)));
    },
    *'AVERAGE/1'(e, t) {
      yield cr(t);
    },
    *'AVERAGEIF/2'(e, t, n) {
      yield Rr(t, n);
    },
    *'AVERAGEIF/3'(e, t, n, r) {
      yield Rr(t, n, r);
    },
    *'AVERAGEIF_BY/4'(e, t, n, r, i) {
      yield Rr(de(t, r), i, de(t, n));
    },
    *'AVERAGEIFS_BY/3'(e, t, n, r) {
      let i = xr(t, r);
      yield cr(de(i, n));
    },
    *'CHAR/1'(e, t) {
      let n = f(t);
      (n === 0 && y(h.value), yield String.fromCharCode(n));
    },
    *'CHOOSE/2'(e, t, n) {
      yield Ga(t, n);
    },
    *'CLEAN/1'(e, t) {
      yield k(t).replace(/[\0-\x1F]/g, '');
    },
    *'CODE/1'(e, t) {
      let r = k(t).charCodeAt(0);
      (Number.isNaN(r) && y(h.value), yield r);
    },
    *'COL/2'(e, t, n) {
      yield de(t, n);
    },
    *'COLUMNS/1'(e, t) {
      if ((Array.isArray(t) || y(h.value), t.length === 0)) {
        yield 0;
        return;
      }
      yield Array.isArray(t[0]) ? t[0].length : t.length;
    },
    *'CONCAT/1'(e, t) {
      yield N(t)
        .map((n) => ln(n))
        .join('');
    },
    *'CONCATENATE/1'(e, t) {
      yield N(t)
        .map((n) => ln(n))
        .join('');
    },
    *'COUNT/1'(e, t) {
      yield Qi(t);
    },
    *'COUNTA/1'(e, t) {
      yield eo(t);
    },
    *'COUNTIF/2'(e, t, n) {
      yield Ao(t, n);
    },
    *'COUNTIF_BY/3'(e, t, n, r) {
      yield Ao(de(t, n), r);
    },
    *'COUNTIFS_BY/2'(e, t, n) {
      yield xr(t, n).length;
    },
    *'COS/1'(e, t) {
      yield P(Math.cos(f(t)));
    },
    *'COSH/1'(e, t) {
      yield P(Math.cosh(f(t)));
    },
    *'COT/1'(e, t) {
      let n = f(t);
      (n === 0 && y(h.div0), yield P(1 / Math.tan(n)));
    },
    *'COTH/1'(e, t) {
      let n = f(t);
      (n === 0 && y(h.div0), yield P(1 / Math.tanh(n)));
    },
    *'CSC/1'(e, t) {
      let n = f(t);
      (n === 0 && y(h.div0), yield P(1 / Math.sin(n)));
    },
    *'CSCH/1'(e, t) {
      let n = f(t);
      (n === 0 && y(h.div0), yield P(1 / Math.sinh(n)));
    },
    *'DOLLAR/1'(e, t) {
      yield wo(t);
    },
    *'DOLLAR/2'(e, t, n) {
      yield wo(t, n);
    },
    *'EXACT/2'(e, t, n) {
      yield k(t) === k(n);
    },
    *'EXP/1'(e, t) {
      yield P(Math.exp(f(t)));
    },
    *'FALSE/0'() {
      yield !1;
    },
    *'FIND/2'(e, t, n) {
      let r = k(n).indexOf(k(t));
      (r === -1 && y(h.value), yield r + 1);
    },
    *'FIND/3'(e, t, n, r) {
      let i = k(n).indexOf(k(t), f(r) - 1);
      (i === -1 && y(h.value), yield i + 1);
    },
    *'FIXED/1'(e, t) {
      yield un(t);
    },
    *'FIXED/2'(e, t, n) {
      yield un(t, n);
    },
    *'FIXED/3'(e, t, n, r) {
      yield un(t, n, r);
    },
    *'FLOOR/1'(e, t) {
      yield on(t);
    },
    *'FLOOR/2'(e, t, n) {
      yield on(t, n);
    },
    *'FLOOR_MATH/1'(e, t) {
      yield on(t);
    },
    *'FLOOR_MATH/2'(e, t, n) {
      yield on(t, n);
    },
    *'HLOOKUP/3'(e, t, n, r) {
      yield xt(t, vo(n), r);
    },
    *'HLOOKUP/4'(e, t, n, r, i) {
      yield xt(t, vo(n), r, i);
    },
    *'INDEX/2'(e, t, n) {
      yield sn(t, n);
    },
    *'INDEX/3'(e, t, n, r) {
      yield sn(t, n, r);
    },
    *'_EXCEL_INDEX/2'(e, t, n) {
      yield sn(t, n);
    },
    *'_EXCEL_INDEX/3'(e, t, n, r) {
      yield sn(t, n, r);
    },
    *'INT/1'(e, t) {
      yield Math.floor(f(t));
    },
    *'ISBLANK/1'(e, t) {
      yield t == null;
    },
    *'ISNUMBER/1'(e, t) {
      yield typeof t == 'number' && !Number.isNaN(t) && Number.isFinite(t);
    },
    *'ISTEXT/1'(e, t) {
      yield typeof t == 'string';
    },
    *'LEFT/1'(e, t) {
      yield k(t).slice(0, 1);
    },
    *'LEFT/2'(e, t, n) {
      yield k(t).slice(0, f(n));
    },
    *'LEN/1'(e, t) {
      yield k(t).length;
    },
    *'LN/1'(e, t) {
      let n = f(t);
      (n <= 0 && y(h.num), yield P(Math.log(n)));
    },
    *'LOG/1'(e, t) {
      yield wr(t);
    },
    *'LOG/2'(e, t, n) {
      yield wr(t, n);
    },
    *'LOG10/1'(e, t) {
      yield wr(t, 10);
    },
    *'LOWER/1'(e, t) {
      yield k(t).toLowerCase();
    },
    *'LOOKUP/2'(e, t, n) {
      yield Sr(t, n);
    },
    *'LOOKUP/3'(e, t, n, r) {
      yield Sr(t, n, r);
    },
    *'LOOKUP_BY/4'(e, t, n, r, i) {
      yield qa(t, n, r, i);
    },
    *'MATCH/2'(e, t, n) {
      yield Io(t, n);
    },
    *'MATCH/3'(e, t, n, r) {
      yield Io(t, n, r);
    },
    *'MAX/1'(e, t) {
      yield no(t);
    },
    *'MID/3'(e, t, n, r) {
      yield k(t).substr(f(n) - 1, f(r));
    },
    *'MIN/1'(e, t) {
      yield to(t);
    },
    *'MOD/2'(e, t, n) {
      let r = f(n);
      (r === 0 && y(h.div0), yield ((f(t) % r) + r) % r);
    },
    *'MULTINOMIAL/1'(e, t) {
      yield Ea(t);
    },
    *'N/1'(e, t) {
      if (typeof t == 'number' && Number.isFinite(t)) {
        yield t;
        return;
      }
      if (t === !0) {
        yield 1;
        return;
      }
      if (t === !1) {
        yield 0;
        return;
      }
      yield 0;
    },
    *'NOT/1'(e, t) {
      (typeof t == 'string' && y(h.value), yield !t);
    },
    *'NUMBERVALUE/1'(e, t) {
      yield Ir(t);
    },
    *'NUMBERVALUE/2'(e, t, n) {
      yield Ir(t, n);
    },
    *'NUMBERVALUE/3'(e, t, n, r) {
      yield Ir(t, n, r);
    },
    *'OR/1'(e, t) {
      yield Va(t);
    },
    *'POWER/2'(e, t, n) {
      yield Math.pow(f(t), f(n));
    },
    *'PRODUCT/1'(e, t) {
      yield N(t)
        .filter((n) => n != null)
        .map((n) => f(n))
        .reduce((n, r) => n * r, 1);
    },
    *'PROPER/1'(e, t) {
      yield Ua(t);
    },
    *'REPLACE/4'(e, t, n, r, i) {
      let o = k(t);
      yield o.slice(0, f(n) - 1) + k(i) + o.slice(f(n) - 1 + f(r));
    },
    *'REPT/2'(e, t, n) {
      yield new Array(f(n) + 1).join(k(t));
    },
    *'RIGHT/1'(e, t) {
      let n = k(t);
      yield n.slice(n.length - 1);
    },
    *'RIGHT/2'(e, t, n) {
      let r = k(t);
      yield r.slice(r.length - f(n));
    },
    *'ROMAN/1'(e, t) {
      yield Fa(t);
    },
    *'ROWS/1'(e, t) {
      (Array.isArray(t) || y(h.value), yield t.length);
    },
    *'ROUND/1'(e, t) {
      yield Fe(t, 0, Math.round);
    },
    *'ROUND/2'(e, t, n) {
      yield Fe(t, n, Math.round);
    },
    *'ROUNDDOWN/1'(e, t) {
      yield Fe(t, 0, Math.floor);
    },
    *'ROUNDDOWN/2'(e, t, n) {
      yield Fe(t, n, Math.floor);
    },
    *'ROUNDUP/1'(e, t) {
      yield Fe(t, 0, Math.ceil);
    },
    *'ROUNDUP/2'(e, t, n) {
      yield Fe(t, n, Math.ceil);
    },
    *'SEARCH/2'(e, t, n) {
      let r = k(n).toLowerCase().indexOf(k(t).toLowerCase());
      (r === -1 && y(h.value), yield r + 1);
    },
    *'SEARCH/3'(e, t, n, r) {
      let i = k(n)
        .toLowerCase()
        .indexOf(k(t).toLowerCase(), f(r) - 1);
      (i === -1 && y(h.value), yield i + 1);
    },
    *'SEC/1'(e, t) {
      yield P(1 / Math.cos(f(t)));
    },
    *'SECH/1'(e, t) {
      yield P(1 / Math.cosh(f(t)));
    },
    *'SERIESSUM/4'(e, t, n, r, i) {
      yield ka(t, n, r, i);
    },
    *'SIN/1'(e, t) {
      yield P(Math.sin(f(t)));
    },
    *'SINH/1'(e, t) {
      yield P(Math.sinh(f(t)));
    },
    *'SQRT/1'(e, t) {
      let n = f(t);
      (n < 0 && y(h.num), yield Math.sqrt(n));
    },
    *'SQRTPI/1'(e, t) {
      let n = f(t);
      (n < 0 && y(h.num), yield P(Math.sqrt(n * Math.PI)));
    },
    *'STDEV/1'(e, t) {
      yield pr(t);
    },
    *'STDEV_P/1'(e, t) {
      yield ro(t);
    },
    *'STDEV_S/1'(e, t) {
      yield pr(t);
    },
    *'SUM/1'(e, t) {
      yield gt(t);
    },
    *'SUMIF/2'(e, t, n) {
      yield vr(t, n);
    },
    *'SUMIF/3'(e, t, n, r) {
      yield vr(t, n, r);
    },
    *'SUMIF_BY/4'(e, t, n, r, i) {
      yield vr(de(t, r), i, de(t, n));
    },
    *'SUMIFS_BY/3'(e, t, n, r) {
      let i = xr(t, r);
      yield gt(de(i, n));
    },
    *'SUBSTITUTE/3'(e, t, n, r) {
      yield k(t).split(k(n)).join(k(r));
    },
    *'SUBSTITUTE/4'(e, t, n, r, i) {
      let o = Math.floor(f(i));
      (o <= 0 && y(h.value), yield Oa(k(t), k(n), k(r), o));
    },
    *'T/1'(e, t) {
      yield typeof t == 'string' ? t : '';
    },
    *'TAN/1'(e, t) {
      yield P(Math.tan(f(t)));
    },
    *'TANH/1'(e, t) {
      yield Math.tanh(f(t));
    },
    *'TEXT/2'(e, t, n) {
      yield Da(t, n);
    },
    *'TEXTJOIN/3'(e, t, n, r) {
      yield za(t, n, r);
    },
    *'TRIM/1'(e, t) {
      yield k(t).replace(/\s+/g, ' ').trim();
    },
    *'TRUNC/1'(e, t) {
      yield xo(t);
    },
    *'TRUNC/2'(e, t, n) {
      yield xo(t, n);
    },
    *'TRUE/0'() {
      yield !0;
    },
    *'TYPE/1'(e, t) {
      if (typeof t == 'number' && Number.isFinite(t)) {
        yield 1;
        return;
      }
      if (typeof t == 'string') {
        yield 2;
        return;
      }
      if (typeof t == 'boolean') {
        yield 4;
        return;
      }
      if (Array.isArray(t)) {
        yield 64;
        return;
      }
      yield 16;
    },
    *'UPPER/1'(e, t) {
      yield k(t).toUpperCase();
    },
    *'VALUE/1'(e, t) {
      yield Ba(t);
    },
    *'VLOOKUP/3'(e, t, n, r) {
      yield xt(t, n, r);
    },
    *'VLOOKUP/4'(e, t, n, r, i) {
      yield xt(t, n, r, i);
    },
    *'VLOOKUP_BY/4'(e, t, n, r, i) {
      yield Ro(t, n, r, i, !1);
    },
    *'VLOOKUP_BY/5'(e, t, n, r, i, o) {
      yield Ro(t, n, r, i, o);
    },
    *'XLOOKUP/3'(e, t, n, r) {
      yield an(t, n, r);
    },
    *'XLOOKUP/4'(e, t, n, r, i) {
      yield an(t, n, r, i);
    },
    *'XLOOKUP/5'(e, t, n, r, i, o) {
      yield an(t, n, r, i, o);
    },
    *'XLOOKUP/6'(e, t, n, r, i, o, s) {
      yield an(t, n, r, i, o, s);
    },
    *'XOR/1'(e, t) {
      yield Xa(t);
    },
    *'CEILING/1'(e, t) {
      yield rn(t);
    },
    *'CEILING/2'(e, t, n) {
      yield rn(t, n);
    },
    *'CEILING_MATH/1'(e, t) {
      yield rn(t);
    },
    *'CEILING_MATH/2'(e, t, n) {
      yield rn(t, n);
    },
    *'PI/0'() {
      yield Math.PI;
    },
    *'SIGN/1'(e, t) {
      let n = f(t);
      yield n > 0 ? 1 : n < 0 ? -1 : 0;
    },
    *'EVEN/1'(e, t) {
      let n = f(t),
        r = Math.ceil(Math.abs(n)),
        i = r % 2 === 0 ? r : r + 1;
      yield n >= 0 ? i : -i;
    },
    *'ODD/1'(e, t) {
      let n = f(t),
        r = Math.ceil(Math.abs(n)),
        i = r % 2 === 1 ? r : r + 1;
      yield n >= 0 ? i : -i;
    },
    *'GCD/1'(e, t) {
      let n = N(t).map(f).map(Math.abs).map(Math.floor);
      if (n.length === 0) yield 0;
      else {
        let r = (i, o) => (o === 0 ? i : r(o, i % o));
        yield n.reduce(r);
      }
    },
    *'LCM/1'(e, t) {
      let n = N(t).map(f).map(Math.abs).map(Math.floor);
      if (n.length === 0) yield 0;
      else {
        let r = (o, s) => (s === 0 ? o : r(s, o % s)),
          i = (o, s) => (o * s) / r(o, s);
        yield n.reduce(i);
      }
    },
    *'FACT/1'(e, t) {
      let n = Math.floor(f(t));
      if ((n < 0 && y(h.num), n === 0)) {
        yield 1;
        return;
      }
      let r = 1;
      for (let i = 2; i <= n; i++) r *= i;
      yield r;
    },
    *'FACTDOUBLE/1'(e, t) {
      let n = Math.floor(f(t));
      if ((n < -1 && y(h.num), n <= 0)) {
        yield 1;
        return;
      }
      let r = 1;
      for (let i = n; i > 1; i -= 2) r *= i;
      yield r;
    },
    *'COMBIN/2'(e, t, n) {
      let r = Math.floor(f(t)),
        i = Math.floor(f(n));
      (r < 0 || i < 0 || i > r) && y(h.num);
      let o = 1;
      for (let s = 0; s < i; s++) o = (o * (r - s)) / (s + 1);
      yield Math.round(o);
    },
    *'COMBINA/2'(e, t, n) {
      let r = Math.floor(f(t)),
        i = Math.floor(f(n));
      (r < 0 || i < 0) && y(h.num);
      let o = r + i - 1,
        s = 1;
      for (let a = 0; a < i; a++) s = (s * (o - a)) / (a + 1);
      yield Math.round(s);
    },
    *'PERMUT/2'(e, t, n) {
      let r = Math.floor(f(t)),
        i = Math.floor(f(n));
      (r < 0 || i < 0 || i > r) && y(h.num);
      let o = 1;
      for (let s = 0; s < i; s++) o *= r - s;
      yield o;
    },
    *'RAND/0'() {
      yield Math.random();
    },
    *'RANDBETWEEN/2'(e, t, n) {
      let r = Math.ceil(f(t)),
        i = Math.floor(f(n));
      (r > i && y(h.num), yield Math.floor(Math.random() * (i - r + 1)) + r);
    },
    *'MROUND/2'(e, t, n) {
      let r = f(t),
        i = f(n);
      if (i === 0) {
        yield 0;
        return;
      }
      (r * i < 0 && y(h.num), yield Math.round(r / i) * i);
    },
    *'QUOTIENT/2'(e, t, n) {
      let r = f(t),
        i = f(n);
      (i === 0 && y(h.div0), yield Math.trunc(r / i));
    },
    *'DEGREES/1'(e, t) {
      yield f(t) * (180 / Math.PI);
    },
    *'RADIANS/1'(e, t) {
      yield f(t) * (Math.PI / 180);
    },
    *'SUMPRODUCT/1'(e, t) {
      if (!Array.isArray(t) || t.length === 0) {
        yield 0;
        return;
      }
      if (Array.isArray(t[0])) {
        let n = t[0].length,
          r = 0;
        for (let i = 0; i < n; i++) {
          let o = 1;
          for (let s of t) {
            let a = Array.isArray(s) ? s[i] : 0;
            o *= typeof a == 'number' ? a : 0;
          }
          r += o;
        }
        yield r;
      } else yield gt(t);
    },
    *'SUMSQ/1'(e, t) {
      let n = N(t),
        r = 0;
      for (let i of n)
        typeof i == 'number' && Number.isFinite(i) && (r += i * i);
      yield r;
    },
    *'SUMX2MY2/2'(e, t, n) {
      yield Ar(t, n, (r, i) => r ** 2 - i ** 2);
    },
    *'SUMX2PY2/2'(e, t, n) {
      yield Ar(t, n, (r, i) => r ** 2 + i ** 2);
    },
    *'SUMXMY2/2'(e, t, n) {
      yield Ar(t, n, (r, i) => (r - i) ** 2);
    },
    *'SWITCH/1'(e, t) {
      (!Array.isArray(t) || t.length < 3) && y(h.value);
      let n = t[0];
      for (let r = 1; r < t.length - 1; r += 2)
        if (t[r] === n) {
          yield t[r + 1];
          return;
        }
      t.length % 2 === 0 ? yield t[t.length - 1] : y(h.na);
    },
    *'ISEVEN/1'(e, t) {
      let n = f(t);
      yield Math.floor(n) % 2 === 0;
    },
    *'ISODD/1'(e, t) {
      let n = f(t);
      yield Math.floor(n) % 2 !== 0;
    },
    *'ISLOGICAL/1'(e, t) {
      yield typeof t == 'boolean';
    },
    *'ISNONTEXT/1'(e, t) {
      yield typeof t != 'string';
    },
    *'MEDIAN/1'(e, t) {
      let n = N(t)
        .filter((i) => typeof i == 'number' && Number.isFinite(i))
        .sort((i, o) => i - o);
      n.length === 0 && y(h.num);
      let r = Math.floor(n.length / 2);
      yield n.length % 2 !== 0 ? n[r] : (n[r - 1] + n[r]) / 2;
    },
    *'LARGE/2'(e, t, n) {
      let r = N(t)
          .filter((o) => typeof o == 'number' && Number.isFinite(o))
          .sort((o, s) => s - o),
        i = Math.floor(f(n));
      ((i < 1 || i > r.length) && y(h.num), yield r[i - 1]);
    },
    *'SMALL/2'(e, t, n) {
      let r = N(t)
          .filter((o) => typeof o == 'number' && Number.isFinite(o))
          .sort((o, s) => o - s),
        i = Math.floor(f(n));
      ((i < 1 || i > r.length) && y(h.num), yield r[i - 1]);
    },
    *'COUNTBLANK/1'(e, t) {
      yield (Array.isArray(t) ? t : [t]).filter((r) => r == null || r === '')
        .length;
    },
    *'VAR/1'(e, t) {
      let n = N(t).filter((o) => typeof o == 'number' && Number.isFinite(o));
      n.length < 2 && y(h.div0);
      let r = n.reduce((o, s) => o + s, 0) / n.length;
      yield n.reduce((o, s) => o + (s - r) ** 2, 0) / (n.length - 1);
    },
    *'VAR_P/1'(e, t) {
      let n = N(t).filter((o) => typeof o == 'number' && Number.isFinite(o));
      n.length === 0 && y(h.div0);
      let r = n.reduce((o, s) => o + s, 0) / n.length;
      yield n.reduce((o, s) => o + (s - r) ** 2, 0) / n.length;
    },
    *'VAR_S/1'(e, t) {
      let n = N(t).filter((o) => typeof o == 'number' && Number.isFinite(o));
      n.length < 2 && y(h.div0);
      let r = n.reduce((o, s) => o + s, 0) / n.length;
      yield n.reduce((o, s) => o + (s - r) ** 2, 0) / (n.length - 1);
    },
    *'MAXIFS/1'(e, t) {
      (!Array.isArray(t) || t.length < 3) && y(h.value);
      let n = Array.isArray(t[0]) ? t[0] : [t[0]],
        r = Array.isArray(t[1]) ? t[1] : [t[1]],
        i = t[2],
        o = Le(i),
        s = -1 / 0,
        a = !1;
      for (let u = 0; u < n.length; u++)
        if (o(r[u] ?? null)) {
          let l = f(n[u]);
          l > s && ((s = l), (a = !0));
        }
      yield a ? s : 0;
    },
    *'MINIFS/1'(e, t) {
      (!Array.isArray(t) || t.length < 3) && y(h.value);
      let n = Array.isArray(t[0]) ? t[0] : [t[0]],
        r = Array.isArray(t[1]) ? t[1] : [t[1]],
        i = t[2],
        o = Le(i),
        s = 1 / 0,
        a = !1;
      for (let u = 0; u < n.length; u++)
        if (o(r[u] ?? null)) {
          let l = f(n[u]);
          l < s && ((s = l), (a = !0));
        }
      yield a ? s : 0;
    },
    *'CORREL/2'(e, t, n) {
      let r = N(t).filter((p) => typeof p == 'number' && Number.isFinite(p)),
        i = N(n).filter((p) => typeof p == 'number' && Number.isFinite(p)),
        o = Math.min(r.length, i.length);
      o < 2 && y(h.div0);
      let s = r.slice(0, o).reduce((p, g) => p + g, 0) / o,
        a = i.slice(0, o).reduce((p, g) => p + g, 0) / o,
        u = 0,
        l = 0,
        c = 0;
      for (let p = 0; p < o; p++) {
        let g = r[p] - s,
          x = i[p] - a;
        ((u += g * x), (l += g * g), (c += x * x));
      }
      let d = Math.sqrt(l * c);
      (d === 0 && y(h.div0), yield u / d);
    },
    *'SLOPE/2'(e, t, n) {
      let r = N(t).filter((c) => typeof c == 'number' && Number.isFinite(c)),
        i = N(n).filter((c) => typeof c == 'number' && Number.isFinite(c)),
        o = Math.min(i.length, r.length);
      o < 2 && y(h.div0);
      let s = i.slice(0, o).reduce((c, d) => c + d, 0) / o,
        a = r.slice(0, o).reduce((c, d) => c + d, 0) / o,
        u = 0,
        l = 0;
      for (let c = 0; c < o; c++)
        ((u += (i[c] - s) * (r[c] - a)), (l += (i[c] - s) ** 2));
      (l === 0 && y(h.div0), yield u / l);
    },
    *'INTERCEPT/2'(e, t, n) {
      let r = N(t).filter((c) => typeof c == 'number' && Number.isFinite(c)),
        i = N(n).filter((c) => typeof c == 'number' && Number.isFinite(c)),
        o = Math.min(i.length, r.length);
      o < 2 && y(h.div0);
      let s = i.slice(0, o).reduce((c, d) => c + d, 0) / o,
        a = r.slice(0, o).reduce((c, d) => c + d, 0) / o,
        u = 0,
        l = 0;
      for (let c = 0; c < o; c++)
        ((u += (i[c] - s) * (r[c] - a)), (l += (i[c] - s) ** 2));
      (l === 0 && y(h.div0), yield a - (u / l) * s);
    },
    *'FORECAST/3'(e, t, n, r) {
      let i = f(t),
        o = N(n).filter((x) => typeof x == 'number' && Number.isFinite(x)),
        s = N(r).filter((x) => typeof x == 'number' && Number.isFinite(x)),
        a = Math.min(s.length, o.length);
      a < 2 && y(h.div0);
      let u = s.slice(0, a).reduce((x, w) => x + w, 0) / a,
        l = o.slice(0, a).reduce((x, w) => x + w, 0) / a,
        c = 0,
        d = 0;
      for (let x = 0; x < a; x++)
        ((c += (s[x] - u) * (o[x] - l)), (d += (s[x] - u) ** 2));
      d === 0 && y(h.div0);
      let p = c / d;
      yield l - p * u + p * i;
    },
    *'RANK_EQ/2'(e, t, n) {
      let r = f(t),
        s = [...N(n).filter((a) => typeof a == 'number' && Number.isFinite(a))]
          .sort((a, u) => u - a)
          .indexOf(r);
      (s === -1 && y(h.na), yield s + 1);
    },
    *'RANK_EQ/3'(e, t, n, r) {
      let i = f(t),
        o = N(n).filter((l) => typeof l == 'number' && Number.isFinite(l)),
        u = (
          f(r) !== 0
            ? [...o].sort((l, c) => l - c)
            : [...o].sort((l, c) => c - l)
        ).indexOf(i);
      (u === -1 && y(h.na), yield u + 1);
    },
    *'RANK_AVG/2'(e, t, n) {
      let r = f(t),
        s = [...N(n).filter((a) => typeof a == 'number' && Number.isFinite(a))]
          .sort((a, u) => u - a)
          .reduce((a, u, l) => (u === r && a.push(l + 1), a), []);
      (s.length === 0 && y(h.na),
        yield s.reduce((a, u) => a + u, 0) / s.length);
    },
    *'PERCENTILE_INC/2'(e, t, n) {
      let r = N(t)
          .filter((l) => typeof l == 'number' && Number.isFinite(l))
          .sort((l, c) => l - c),
        i = f(n);
      (i < 0 || i > 1 || r.length === 0) && y(h.num);
      let o = r.length,
        s = i * (o - 1),
        a = Math.floor(s),
        u = s - a;
      a + 1 < o ? yield r[a] + u * (r[a + 1] - r[a]) : yield r[a];
    },
    *'QUARTILE_INC/2'(e, t, n) {
      let r = N(t)
          .filter((c) => typeof c == 'number' && Number.isFinite(c))
          .sort((c, d) => c - d),
        i = Math.floor(f(n));
      (i < 0 || i > 4 || r.length === 0) && y(h.num);
      let o = i * 0.25,
        s = r.length,
        a = o * (s - 1),
        u = Math.floor(a),
        l = a - u;
      u + 1 < s ? yield r[u] + l * (r[u + 1] - r[u]) : yield r[u];
    },
    *'AVEDEV/1'(e, t) {
      let n = N(t).filter((i) => typeof i == 'number' && Number.isFinite(i));
      n.length === 0 && y(h.num);
      let r = n.reduce((i, o) => i + o, 0) / n.length;
      yield n.reduce((i, o) => i + Math.abs(o - r), 0) / n.length;
    },
    *'DEVSQ/1'(e, t) {
      let n = N(t).filter((i) => typeof i == 'number' && Number.isFinite(i));
      n.length === 0 && y(h.num);
      let r = n.reduce((i, o) => i + o, 0) / n.length;
      yield n.reduce((i, o) => i + (o - r) ** 2, 0);
    },
    *'GEOMEAN/1'(e, t) {
      let n = N(t).filter(
        (i) => typeof i == 'number' && Number.isFinite(i) && i > 0,
      );
      n.length === 0 && y(h.num);
      let r = n.reduce((i, o) => i + Math.log(o), 0);
      yield Math.exp(r / n.length);
    },
    *'HARMEAN/1'(e, t) {
      let n = N(t).filter(
        (i) => typeof i == 'number' && Number.isFinite(i) && i > 0,
      );
      n.length === 0 && y(h.num);
      let r = n.reduce((i, o) => i + 1 / o, 0);
      yield n.length / r;
    },
    *'TRIMMEAN/2'(e, t, n) {
      let r = N(t)
          .filter((a) => typeof a == 'number' && Number.isFinite(a))
          .sort((a, u) => a - u),
        i = f(n);
      (i < 0 || i >= 1 || r.length === 0) && y(h.num);
      let o = Math.floor((r.length * i) / 2),
        s = r.slice(o, r.length - o);
      (s.length === 0 && y(h.num),
        yield s.reduce((a, u) => a + u, 0) / s.length);
    },
    *'SKEW/1'(e, t) {
      let n = N(t).filter((a) => typeof a == 'number' && Number.isFinite(a)),
        r = n.length;
      r < 3 && y(h.div0);
      let i = n.reduce((a, u) => a + u, 0) / r,
        o = Math.sqrt(n.reduce((a, u) => a + (u - i) ** 2, 0) / (r - 1));
      o === 0 && y(h.div0);
      let s = n.reduce((a, u) => a + ((u - i) / o) ** 3, 0);
      yield (r / ((r - 1) * (r - 2))) * s;
    },
    *'KURT/1'(e, t) {
      let n = N(t).filter((l) => typeof l == 'number' && Number.isFinite(l)),
        r = n.length;
      r < 4 && y(h.div0);
      let i = n.reduce((l, c) => l + c, 0) / r,
        o = Math.sqrt(n.reduce((l, c) => l + (c - i) ** 2, 0) / (r - 1));
      o === 0 && y(h.div0);
      let s = n.reduce((l, c) => l + ((c - i) / o) ** 4, 0),
        a = (r * (r + 1)) / ((r - 1) * (r - 2) * (r - 3)),
        u = (3 * (r - 1) ** 2) / ((r - 2) * (r - 3));
      yield a * s - u;
    },
    *'DAYS/2'(e, t, n) {
      let r = f(t),
        i = f(n);
      yield r - i;
    },
    *'TODAY/0'() {
      let e = new Date(),
        t = new Date(1899, 11, 30);
      yield Math.floor((e.getTime() - t.getTime()) / 864e5);
    },
    *'NOW/0'() {
      yield Ma();
    },
    *'HOUR/1'(e, t) {
      let n = f(t),
        r = n - Math.floor(n);
      yield Math.floor(r * 24) % 24;
    },
    *'MINUTE/1'(e, t) {
      let n = f(t),
        r = n - Math.floor(n);
      yield Math.floor(r * 24 * 60) % 60;
    },
    *'SECOND/1'(e, t) {
      let n = f(t),
        r = n - Math.floor(n);
      yield Math.floor(r * 24 * 60 * 60) % 60;
    },
    *'WEEKDAY/1'(e, t) {
      let n = Math.floor(f(t)),
        r = new Date(1899, 11, 30);
      yield new Date(r.getTime() + n * 864e5).getDay() + 1;
    },
    *'WEEKDAY/2'(e, t, n) {
      let r = Math.floor(f(t)),
        i = new Date(1899, 11, 30),
        o = new Date(i.getTime() + r * 864e5),
        s = Math.floor(f(n)),
        a = o.getDay();
      s === 1
        ? yield a + 1
        : s === 2
          ? yield a === 0 ? 7 : a
          : s === 3
            ? yield a === 0 ? 6 : a - 1
            : yield a + 1;
    },
    *'ISOWEEKNUM/1'(e, t) {
      let n = Math.floor(f(t)),
        r = new Date(1899, 11, 30),
        i = new Date(r.getTime() + n * 864e5),
        o =
          Math.floor(
            (i.getTime() - new Date(i.getFullYear(), 0, 1).getTime()) / 864e5,
          ) + 1,
        s = i.getDay() || 7;
      yield Math.floor((o - s + 10) / 7);
    },
    *'EDATE/2'(e, t, n) {
      let r = Math.floor(f(t)),
        i = Math.floor(f(n)),
        o = new Date(1899, 11, 30),
        s = new Date(o.getTime() + r * 864e5);
      (s.setMonth(s.getMonth() + i),
        yield Math.floor((s.getTime() - o.getTime()) / 864e5));
    },
    *'EOMONTH/2'(e, t, n) {
      let r = Math.floor(f(t)),
        i = Math.floor(f(n)),
        o = new Date(1899, 11, 30),
        s = new Date(o.getTime() + r * 864e5);
      (s.setMonth(s.getMonth() + i + 1, 0),
        yield Math.floor((s.getTime() - o.getTime()) / 864e5));
    },
    *'TIME/3'(e, t, n, r) {
      let i = f(t),
        o = f(n),
        s = f(r);
      yield (i * 3600 + o * 60 + s) / 86400;
    },
    *'TIMEVALUE/1'(e, t) {
      let r = String(t).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      r || y(h.value);
      let i = parseInt(r[1], 10),
        o = parseInt(r[2], 10),
        s = r[3] ? parseInt(r[3], 10) : 0;
      yield (i * 3600 + o * 60 + s) / 86400;
    },
    *'PERCENTILE_EXC/2'(e, t, n) {
      let r = N(t)
          .filter((l) => typeof l == 'number' && Number.isFinite(l))
          .sort((l, c) => l - c),
        i = f(n),
        o = r.length;
      (i <= 1 / (o + 1) || i >= o / (o + 1) || o === 0) && y(h.num);
      let s = i * (o + 1) - 1,
        a = Math.floor(s),
        u = s - a;
      a + 1 < o ? yield r[a] + u * (r[a + 1] - r[a]) : yield r[a];
    },
    *'QUARTILE_EXC/2'(e, t, n) {
      let r = N(t)
          .filter((c) => typeof c == 'number' && Number.isFinite(c))
          .sort((c, d) => c - d),
        i = Math.floor(f(n));
      (i < 1 || i > 3 || r.length === 0) && y(h.num);
      let o = i * 0.25,
        s = r.length,
        a = o * (s + 1) - 1,
        u = Math.floor(a),
        l = a - u;
      u >= 0 && u + 1 < s
        ? yield r[u] + l * (r[u + 1] - r[u])
        : u >= 0 && u < s
          ? yield r[u]
          : y(h.num);
    },
    *'PERCENTRANK_INC/2'(e, t, n) {
      let r = N(t)
          .filter((s) => typeof s == 'number' && Number.isFinite(s))
          .sort((s, a) => s - a),
        i = f(n),
        o = r.length;
      if (((o === 0 || i < r[0] || i > r[o - 1]) && y(h.na), o === 1)) {
        yield 0;
        return;
      }
      for (let s = 0; s < o; s++) {
        if (r[s] === i) {
          yield s / (o - 1);
          return;
        }
        if (s + 1 < o && r[s] < i && i < r[s + 1]) {
          yield (s + (i - r[s]) / (r[s + 1] - r[s])) / (o - 1);
          return;
        }
      }
      yield 0;
    },
    *'PERCENTRANK_EXC/2'(e, t, n) {
      let r = N(t)
          .filter((s) => typeof s == 'number' && Number.isFinite(s))
          .sort((s, a) => s - a),
        i = f(n),
        o = r.length;
      (o === 0 || i < r[0] || i > r[o - 1]) && y(h.na);
      for (let s = 0; s < o; s++) {
        if (r[s] === i) {
          yield (s + 1) / (o + 1);
          return;
        }
        if (s + 1 < o && r[s] < i && i < r[s + 1]) {
          yield (s + 1 + (i - r[s]) / (r[s + 1] - r[s])) / (o + 1);
          return;
        }
      }
      yield 0;
    },
    *'PEARSON/2'(e, t, n) {
      let r = N(t).filter((p) => typeof p == 'number' && Number.isFinite(p)),
        i = N(n).filter((p) => typeof p == 'number' && Number.isFinite(p)),
        o = Math.min(r.length, i.length);
      o < 2 && y(h.div0);
      let s = r.slice(0, o).reduce((p, g) => p + g, 0) / o,
        a = i.slice(0, o).reduce((p, g) => p + g, 0) / o,
        u = 0,
        l = 0,
        c = 0;
      for (let p = 0; p < o; p++) {
        let g = r[p] - s,
          x = i[p] - a;
        ((u += g * x), (l += g * g), (c += x * x));
      }
      let d = Math.sqrt(l * c);
      (d === 0 && y(h.div0), yield u / d);
    },
    *'UNICODE/1'(e, t) {
      let n = k(t);
      (n.length === 0 && y(h.value), yield n.codePointAt(0));
    },
  },
  To = { ...Re(Wa), ...go };
De();
cn();
function ae(e) {
  return new Set(e.map((t) => t.toUpperCase()));
}
var Nr = ae([
    'AVEDEV',
    'AVERAGE',
    'AVERAGEIF',
    'AVERAGEIF_BY',
    'AVERAGEIFS_BY',
    'CHISQ_TEST',
    'COUNT',
    'COUNTA',
    'COUNTBLANK',
    'COUNTIF',
    'COUNTIF_BY',
    'COUNTIFS_BY',
    'CORREL',
    'DEVSQ',
    'F_TEST',
    'FORECAST',
    'FVSCHEDULE',
    'GCD',
    'GEOMEAN',
    'HARMEAN',
    'IMPRODUCT',
    'IMSUM',
    'IRR',
    'IRR_BY',
    'KURT',
    'LARGE',
    'LCM',
    'MAX',
    'MAXIFS',
    'MEDIAN',
    'MIN',
    'MINIFS',
    'MIRR',
    'MULTINOMIAL',
    'NPV',
    'NPV_BY',
    'PEARSON',
    'PERCENTILE_EXC',
    'PERCENTILE_INC',
    'PERCENTRANK_EXC',
    'PERCENTRANK_INC',
    'QUARTILE_EXC',
    'QUARTILE_INC',
    'PRODUCT',
    'RANK_AVG',
    'RANK_EQ',
    'SERIESSUM',
    'SKEW',
    'SLOPE',
    'SMALL',
    'STDEV',
    'STDEV_P',
    'STDEV_S',
    'SUM',
    'SUMIF',
    'SUMIF_BY',
    'SUMIFS_BY',
    'SUMPRODUCT',
    'SUMSQ',
    'SUMX2MY2',
    'SUMX2PY2',
    'SUMXMY2',
    'T_TEST',
    'TRIMMEAN',
    'VAR',
    'VAR_P',
    'VAR_S',
    'XIRR',
    'XIRR_BY',
    'XNPV',
    'XNPV_BY',
    'Z_TEST',
  ]),
  Er = ae([
    'auth_check',
    'auth_check_result',
    'auth_list_objects',
    'auth_list_users',
  ]),
  Co = ae(['direct', 'except', 'userset', 'userset_from', 'via']),
  Qa = ae([
    'ACCRINT',
    'BASE',
    'BESSELI',
    'BESSELJ',
    'BESSELK',
    'BESSELY',
    'BETA_DIST',
    'BETA_INV',
    'BIN2DEC',
    'BIN2HEX',
    'BIN2OCT',
    'BINOM_DIST',
    'BINOM_DIST_RANGE',
    'BINOM_INV',
    'BITAND',
    'BITLSHIFT',
    'BITOR',
    'BITRSHIFT',
    'BITXOR',
    'CHISQ_DIST',
    'CHISQ_DIST_RT',
    'CHISQ_INV',
    'CHISQ_INV_RT',
    'COMPLEX',
    'CONFIDENCE_NORM',
    'CONFIDENCE_T',
    'CONVERT',
    'COUPDAYS',
    'CUMIPMT',
    'CUMPRINC',
    'DB',
    'DDB',
    'DEC2BIN',
    'DEC2HEX',
    'DEC2OCT',
    'DECIMAL',
    'DELTA',
    'DISC',
    'DOLLARDE',
    'DOLLARFR',
    'EFFECT',
    'ERF',
    'ERFC',
    'EXPON_DIST',
    'F_DIST',
    'F_DIST_RT',
    'F_INV',
    'F_INV_RT',
    'FV',
    'GAMMA',
    'GAMMA_DIST',
    'GAMMA_INV',
    'GAMMALN',
    'GAMMALN_PRECISE',
    'GAUSS',
    'GESTEP',
    'HEX2BIN',
    'HEX2DEC',
    'HEX2OCT',
    'HYPGEOM_DIST',
    'IMABS',
    'IMAGINARY',
    'IMARGUMENT',
    'IMCONJUGATE',
    'IMCOS',
    'IMCOSH',
    'IMCOT',
    'IMCSC',
    'IMCSCH',
    'IMDIV',
    'IMEXP',
    'IMLN',
    'IMLOG10',
    'IMLOG2',
    'IMPOWER',
    'IMREAL',
    'IMSEC',
    'IMSECH',
    'IMSIN',
    'IMSINH',
    'IMSQRT',
    'IMSUB',
    'IMTAN',
    'IPMT',
    'ISPMT',
    'LOGNORM_DIST',
    'LOGNORM_INV',
    'NEGBINOM_DIST',
    'NOMINAL',
    'NORM_DIST',
    'NORM_INV',
    'NORM_S_DIST',
    'NORM_S_INV',
    'NPER',
    'OCT2BIN',
    'OCT2DEC',
    'OCT2HEX',
    'PDURATION',
    'PHI',
    'PMT',
    'POISSON_DIST',
    'PPMT',
    'PRICEDISC',
    'PV',
    'RATE',
    'RRI',
    'SLN',
    'STANDARDIZE',
    'SYD',
    'T_DIST',
    'T_DIST_2T',
    'T_DIST_RT',
    'T_INV',
    'T_INV_2T',
    'TBILLEQ',
    'TBILLPRICE',
    'TBILLYIELD',
    'UNICHAR',
    'WEIBULL_DIST',
    ...No,
  ]),
  kr = ae(['ERROR_TYPE', 'IFERROR', 'IFNA', 'ISERR', 'ISERROR', 'ISNA', 'try']),
  pn = ae(['NOW', 'RAND', 'RANDBETWEEN', 'TODAY', 'now', ...Eo]),
  _r = ae([
    'debug',
    'empty',
    'env',
    'error',
    'halt',
    'halt_error',
    'input',
    'input_filename',
    'input_line_number',
    'stderr',
  ]),
  eu = ae([
    'debug',
    'env',
    'error',
    'halt',
    'halt_error',
    'input',
    'input_filename',
    'input_line_number',
    'stderr',
  ]),
  dn = ae([
    'builtins',
    'get_jq_origin',
    'get_prog_origin',
    'get_search_list',
    'modulemeta',
  ]),
  $o = ae([
    'IN',
    'age',
    'between',
    'like',
    'matches',
    'NOT',
    'not',
    'overlaps',
    'present',
  ]),
  _o = ae([...pn, ...eu, ...dn]),
  tu = new Map([
    ...[...Nr].map((e) => [e, 'aggregate']),
    ...[...Er].map((e) => [e, 'authorization']),
    ...[...Co].map((e) => [e, 'authorization']),
    ...[...Qa].map((e) => [e, 'boundedScalar']),
    ...[...kr].map((e) => [e, 'errorMasking']),
    ...[...pn].map((e) => [e, 'volatile']),
    ...[..._r].map((e) => [e, 'controlOrSideEffect']),
    ...[...dn].map((e) => [e, 'metadata']),
    ...[...$o].map((e) => [e, 'predicateLowerable']),
  ]),
  nu = new Set([...Nr, ...Er, ...Co, ...kr, ...pn, ..._r, ...dn]),
  ru = new Set([...Nr, ...Er, ...kr, ...pn, ..._r, ...dn]),
  iu = {
    policy: {
      deniedCalls: nu,
      denyMessageByCategory: {
        aggregate: 'aggregate calls can pull work across collections',
        authorization:
          'authorization conditions cannot recursively invoke the authorization kernel',
        controlOrSideEffect:
          'control/side-effect calls are not request-time authorization predicates',
        errorMasking:
          'error-masking calls can hide fail-closed authorization errors',
        metadata: 'runtime metadata calls are not authorization predicates',
        volatile:
          'volatile calls are not stable request-time authorization predicates',
      },
    },
    authorization: {
      deniedCalls: ru,
      denyMessageByCategory: {
        aggregate: 'aggregate calls can pull work across collections',
        authorization:
          'authorization rewrites cannot recursively invoke the authorization kernel',
        controlOrSideEffect:
          'control/side-effect calls are not relationship-graph predicates',
        errorMasking:
          'error-masking calls can hide fail-closed authorization errors',
        metadata:
          'runtime metadata calls are not relationship-graph predicates',
        volatile: 'volatile calls are not stable relationship-graph predicates',
      },
    },
    predicate: { allowedCalls: $o },
    derive: {
      deniedCalls: _o,
      denyMessageByCategory: {
        controlOrSideEffect:
          'control/side-effect calls are not stable write-time derivations',
        metadata:
          'runtime metadata calls are not stable write-time derivations',
        volatile: 'volatile calls are not stable write-time derivations',
      },
    },
    mutation: {
      deniedCalls: _o,
      denyMessageByCategory: {
        controlOrSideEffect:
          'control/side-effect calls are not pure mutation-plan expressions',
        metadata:
          'runtime metadata calls are not stable mutation-plan expressions',
        volatile: 'volatile calls are not repeatable mutation-plan expressions',
      },
    },
  };
function Mo(e) {
  return e.toUpperCase();
}
function ou(e) {
  return tu.get(Mo(e));
}
function At(e, t) {
  let n = Mo(t);
  if (e === 'compute') return { safety: 'allow', normalizedName: n };
  let r = iu[e],
    i = ou(t);
  return r.allowedCalls
    ? r.allowedCalls.has(n)
      ? { safety: 'allow', normalizedName: n, category: i }
      : { safety: 'deny', normalizedName: n, category: i }
    : r.deniedCalls?.has(n)
      ? {
          safety: 'deny',
          normalizedName: n,
          category: i,
          message: i ? r.denyMessageByCategory?.[i] : void 0,
        }
      : i
        ? { safety: 'allow', normalizedName: n, category: i }
        : { safety: 'unclassified', normalizedName: n, category: i };
}
var su = new Set(['=', '|=', '+=', '-=', '*=', '/=', '%=', '//=']);
function It(e, t = {}) {
  let n = vt(e, t);
  return au(n, t);
}
function au(e, t = {}) {
  let n = {
    type: 'program',
    source: e.source,
    canonicalSource: e.compiledSource,
    warnings: e.readableWarnings,
    body: e.ast.expr ? C(e.ast.expr) : null,
    profile: t.profile,
    attachment: t.attachment,
    profileIssues: [],
  };
  return (
    t.profile &&
      (n.profileIssues = uu(n, {
        profile: t.profile,
        attachment: t.attachment,
      })),
    n
  );
}
function uu(e, t) {
  let n = [],
    r = e.type === 'program' ? e.body : e;
  return (
    r &&
      Oo(r, void 0, (i, o) => {
        (t.profile !== 'compute' && lu(i, t.profile, n),
          (t.profile === 'policy' || t.profile === 'authorization') &&
            cu(i, t.profile, n),
          t.profile === 'predicate' && pu(i, o, n),
          t.profile === 'derive' && du(i, o, n),
          t.profile === 'mutation' && fu(i, n));
      }),
    n
  );
}
function Oo(e, t, n) {
  n(e, t);
  for (let r of Bu(e)) Oo(r, e, n);
}
function lu(e, t, n) {
  (e.type === 'def' &&
    n.push({
      code: `${t}-def-banned`,
      severity: 'error',
      message: `${Ne(t)} does not allow user-defined helpers.`,
      nodeType: e.type,
    }),
    (e.type === 'reduce' || e.type === 'foreach') &&
      t !== 'derive' &&
      n.push({
        code: `${t}-loop-banned`,
        severity: 'error',
        message: `${Ne(t)} does not allow explicit reduce/foreach loops.`,
        nodeType: e.type,
      }),
    e.type === 'recursiveDescent' &&
      n.push({
        code: `${t}-recursive-descent-banned`,
        severity: 'error',
        message: `${Ne(t)} does not allow recursive descent.`,
        nodeType: e.type,
      }),
    t !== 'mutation' &&
      e.type === 'binary' &&
      su.has(e.operator) &&
      n.push({
        code: `${t}-assignment-banned`,
        severity: 'error',
        message: `${Ne(t)} does not allow jq assignment operator ${e.operator}.`,
        nodeType: e.type,
      }),
    e.type === 'try' &&
      !(t === 'derive' && e.short) &&
      n.push({
        code: `${t}-try-banned`,
        severity: 'error',
        message: `${Ne(t)} does not allow jq try/catch error masking.`,
        nodeType: e.type,
      }),
    (e.type === 'label' || e.type === 'break') &&
      n.push({
        code: `${t}-control-flow-banned`,
        severity: 'error',
        message: `${Ne(t)} does not allow jq label/break control flow.`,
        nodeType: e.type,
      }),
    e.type === 'format' &&
      n.push({
        code: `${t}-format-banned`,
        severity: 'error',
        message: `${Ne(t)} does not allow jq format filters.`,
        nodeType: e.type,
      }));
}
function cu(e, t, n) {
  if (e.type !== 'call') return;
  let r = At(t, e.name);
  r.safety === 'deny' &&
    n.push({
      code:
        r.category === 'aggregate'
          ? `${t}-aggregate-banned`
          : `${t}-call-banned`,
      severity: 'error',
      message: `${Ne(t)} does not allow call ${e.name}${r.message ? `: ${r.message}` : ''}.`,
      nodeType: e.type,
    });
}
function pu(e, t, n) {
  (e.type === 'binding' &&
    n.push({
      code: 'predicate-binding-banned',
      severity: 'error',
      message:
        'Profile.predicate must compile to a query-time boolean predicate and cannot use local jq bindings.',
      nodeType: e.type,
    }),
    e.type === 'variable' &&
      n.push({
        code: 'predicate-variable-banned',
        severity: 'error',
        message:
          'Profile.predicate must compile to a query-time boolean predicate and cannot use free jq variables.',
        nodeType: e.type,
      }),
    e.type === 'contextPath' &&
      (e.root === '$new' || e.root === '$old') &&
      n.push({
        code: 'predicate-state-context-banned',
        severity: 'error',
        message: `Profile.predicate must compile to a query-time boolean predicate and cannot use mutation state ${e.root}.`,
        nodeType: e.type,
      }),
    gu(e) &&
      n.push({
        code: 'predicate-dynamic-path-banned',
        severity: 'error',
        message:
          'Profile.predicate must compile to a query-time boolean predicate and cannot use iterator, slice, or dynamic-index paths.',
        nodeType: e.type,
      }),
    e.type === 'call' &&
      At('predicate', e.name).safety !== 'allow' &&
      n.push({
        code: 'predicate-call-banned',
        severity: 'error',
        message: `Profile.predicate must compile to a query-time boolean predicate and cannot use call ${e.name}.`,
        nodeType: e.type,
      }),
    !(e.type === 'binary' && e.operator === ',' && mu(t)) &&
      ((e.type === 'binary' && e.operator === '|' && hu(e)) ||
        (e.type === 'binary' &&
          !yu(e.operator) &&
          n.push({
            code: 'predicate-operator-banned',
            severity: 'error',
            message: `Profile.predicate must compile to a query-time boolean predicate and cannot use operator ${e.operator}.`,
            nodeType: e.type,
          }))));
}
function du(e, t, n) {
  if (
    (e.type === 'contextPath' &&
      n.push({
        code: 'derive-context-banned',
        severity: 'error',
        message: `Profile.derive is for deterministic write/index-time computation and cannot use request or environment context ${e.root}.`,
        nodeType: e.type,
      }),
    e.type === 'call')
  ) {
    let r = At('derive', e.name);
    r.safety === 'deny' &&
      n.push({
        code: 'derive-call-banned',
        severity: 'error',
        message: `Profile.derive is for deterministic write/index-time computation and cannot use call ${e.name}${r.message ? `: ${r.message}` : ''}.`,
        nodeType: e.type,
      });
  }
}
function fu(e, t) {
  if (
    (e.type === 'contextPath' &&
      t.push({
        code: 'mutation-context-banned',
        severity: 'error',
        message: `Profile.mutation plans against one explicit loaded snapshot and cannot use ambient context ${e.root}.`,
        nodeType: e.type,
      }),
    e.type === 'call')
  ) {
    let n = At('mutation', e.name);
    n.safety === 'deny' &&
      t.push({
        code: 'mutation-call-banned',
        severity: 'error',
        message: `Profile.mutation requires deterministic pure plan expressions and cannot use call ${e.name}${n.message ? `: ${n.message}` : ''}.`,
        nodeType: e.type,
      });
  }
}
function mu(e) {
  return e?.type === 'array' || (e?.type === 'binary' && e.operator === ',');
}
function hu(e) {
  return (
    e.right.type === 'call' &&
    ((['IN', 'overlaps'].includes(e.right.name) && e.right.args.length === 1) ||
      (e.right.name === 'not' && e.right.args.length === 0))
  );
}
function Ne(e) {
  switch (e) {
    case 'compute':
      return 'Profile.compute';
    case 'policy':
      return 'Profile.policy is for bounded request-time authorization decisions and';
    case 'authorization':
      return 'Profile.authorization extends Profile.policy with bounded relationship-graph composition and';
    case 'predicate':
      return 'Profile.predicate must compile to a query-time boolean predicate and';
    case 'derive':
      return 'Profile.derive is for deterministic write/index-time computation and';
    case 'mutation':
      return 'Profile.mutation is for bounded Card/Field write planning and';
  }
}
function yu(e) {
  return [
    '+',
    '-',
    '*',
    '/',
    '%',
    'and',
    'or',
    '==',
    '!=',
    '<',
    '<=',
    '>',
    '>=',
    '//',
  ].includes(e);
}
function gu(e) {
  return (
    (e.type === 'path' || e.type === 'contextPath') &&
    e.parts.some(
      (t) =>
        t.type === 'iterator' ||
        t.type === 'slice' ||
        t.type === 'dynamic-index',
    )
  );
}
function C(e) {
  let t = Mu(e);
  if (t) return t;
  switch (e.type) {
    case 'str':
      return bu(e);
    case 'num':
      return { type: 'literal', value: e.value, valueType: 'number' };
    case 'bool':
      return { type: 'literal', value: e.value, valueType: 'boolean' };
    case 'null':
      return { type: 'literal', value: null, valueType: 'null' };
    case 'filter':
      return xu(e);
    case 'binary':
      return wu(e);
    case 'unary':
      return Au(e);
    case 'if':
      return Iu(e);
    case 'array':
      return vu(e);
    case 'object':
      return Ru(e);
    case 'def':
      return Su(e);
    case 'try':
      return Tu(e);
    case 'reduce':
      return Nu(e);
    case 'foreach':
      return Eu(e);
    case 'varDeclaration':
      return ku(e);
    case 'label':
      return _u(e);
    case 'break':
      return Cu(e);
    case 'format':
      return $u(e);
    case 'recursiveDescent':
      return { type: 'recursiveDescent' };
    case 'var':
      return { type: 'variable', name: e.name };
    case 'identity':
      return { type: 'path', root: 'current', parts: [] };
    case 'index':
      return {
        type: 'index',
        expr: C(e.expr),
        index: typeof e.index == 'string' ? e.index : C(e.index),
      };
    case 'slice':
      return {
        type: 'slice',
        expr: C(e.expr),
        from: e.from ? C(e.from) : void 0,
        to: e.to ? C(e.to) : void 0,
      };
    case 'iterator':
      return { type: 'iterator', expr: C(e.expr) };
  }
}
function bu(e) {
  return e.interpolated
    ? {
        type: 'literal',
        valueType: 'interpolated-string',
        parts: e.parts.map((t) => (typeof t == 'string' ? t : C(t))),
      }
    : {
        type: 'literal',
        value: e.value,
        valueType: 'string',
        interpolated: !1,
      };
}
function xu(e) {
  let { name: t, arity: n } = Bo(e.name);
  return { type: 'call', name: t, arity: n, args: e.args.map(C) };
}
function wu(e) {
  return {
    type: 'binary',
    operator: e.operator,
    left: C(e.left),
    right: C(e.right),
  };
}
function Au(e) {
  return { type: 'unary', operator: e.operator, expr: C(e.expr) };
}
function Iu(e) {
  return {
    type: 'if',
    cond: C(e.cond),
    then: C(e.then),
    elifs: (e.elifs ?? []).map((t) => ({ cond: C(t.cond), then: C(t.then) })),
    else: e.else ? C(e.else) : void 0,
  };
}
function vu(e) {
  return { type: 'array', expr: e.expr ? C(e.expr) : void 0 };
}
function Ru(e) {
  return {
    type: 'object',
    entries: e.entries.map((t) =>
      t.value !== void 0
        ? {
            key: typeof t.key == 'string' ? t.key : C(t.key),
            value: C(t.value),
          }
        : { key: t.key },
    ),
  };
}
function Su(e) {
  return {
    type: 'def',
    name: e.name,
    args: e.args.map((t) => ({
      type: t.type === 'filterArg' ? 'filter' : 'var',
      name: t.name,
    })),
    body: C(e.body),
    next: e.next ? C(e.next) : void 0,
  };
}
function Tu(e) {
  return {
    type: 'try',
    short: e.short,
    body: C(e.body),
    catch: e.catch ? C(e.catch) : void 0,
  };
}
function Nu(e) {
  return {
    type: 'reduce',
    expr: C(e.expr),
    variable: e.var,
    init: C(e.init),
    update: C(e.update),
  };
}
function Eu(e) {
  return {
    type: 'foreach',
    expr: C(e.expr),
    variable: e.var,
    init: C(e.init),
    update: C(e.update),
    extract: e.extract ? C(e.extract) : void 0,
  };
}
function ku(e) {
  return {
    type: 'binding',
    expr: C(e.expr),
    names: e.destructuring.flatMap($r),
    next: C(e.next),
  };
}
function _u(e) {
  return { type: 'label', value: e.value, next: C(e.next) };
}
function Cu(e) {
  return { type: 'break', value: e.value };
}
function $u(e) {
  return { type: 'format', name: e.name };
}
function Mu(e) {
  let t = [],
    n = e;
  for (;;) {
    if (n.type === 'index') {
      (t.unshift(Ou(n)), (n = n.expr));
      continue;
    }
    if (n.type === 'iterator') {
      (t.unshift({ type: 'iterator' }), (n = n.expr));
      continue;
    }
    if (n.type === 'slice') {
      (t.unshift({
        type: 'slice',
        from: n.from ? C(n.from) : void 0,
        to: n.to ? C(n.to) : void 0,
      }),
        (n = n.expr));
      continue;
    }
    break;
  }
  if (n.type === 'identity') return { type: 'path', root: 'current', parts: t };
  if (n.type === 'var') {
    if (Cr(n.name)) return { type: 'contextPath', root: n.name, parts: t };
    if (t.length === 0) return;
  }
  if (n.type === 'format' && Cr(n.name))
    return { type: 'contextPath', root: n.name, parts: t };
  if (n.type === 'filter') {
    let { name: r, arity: i } = Bo(n.name);
    if (i === 0 && Cr(r)) return { type: 'contextPath', root: r, parts: t };
  }
}
function Ou(e) {
  return typeof e.index == 'string'
    ? { type: 'field', key: e.index }
    : e.index.type === 'num'
      ? { type: 'index', value: e.index.value }
      : { type: 'dynamic-index', expr: C(e.index) };
}
function Cr(e) {
  return (
    e === '@User' ||
    e === '@Env' ||
    e === '$new' ||
    e === '$old' ||
    e === 'Record'
  );
}
function Bo(e) {
  let t = e.lastIndexOf('/');
  return t === -1
    ? { name: e, arity: 0 }
    : { name: e.slice(0, t), arity: Number(e.slice(t + 1)) };
}
function $r(e) {
  return e.type === 'var'
    ? [e.name]
    : e.type === 'arrayDestructuring'
      ? e.destructuring.flatMap($r)
      : e.entries.flatMap((t) =>
          t.destructuring !== void 0
            ? $r(t.destructuring)
            : t.key.type === 'var'
              ? [t.key.name]
              : [],
        );
}
function Bu(e) {
  switch (e.type) {
    case 'literal':
      return e.valueType === 'interpolated-string'
        ? e.parts.filter((t) => typeof t != 'string')
        : [];
    case 'path':
    case 'contextPath':
      return e.parts.flatMap(Du);
    case 'variable':
    case 'format':
    case 'break':
    case 'recursiveDescent':
      return [];
    case 'call':
      return e.args;
    case 'binary':
      return [e.left, e.right];
    case 'unary':
      return [e.expr];
    case 'if':
      return [
        e.cond,
        e.then,
        ...e.elifs.flatMap((t) => [t.cond, t.then]),
        ...(e.else ? [e.else] : []),
      ];
    case 'array':
      return e.expr ? [e.expr] : [];
    case 'object':
      return e.entries.flatMap((t) =>
        t.value === void 0
          ? []
          : [...(typeof t.key == 'string' ? [] : [t.key]), t.value],
      );
    case 'index':
      return [e.expr, ...(typeof e.index == 'string' ? [] : [e.index])];
    case 'slice':
      return [e.expr, ...(e.from ? [e.from] : []), ...(e.to ? [e.to] : [])];
    case 'iterator':
      return [e.expr];
    case 'def':
      return [e.body, ...(e.next ? [e.next] : [])];
    case 'try':
      return [e.body, ...(e.catch ? [e.catch] : [])];
    case 'reduce':
      return [e.expr, e.init, e.update];
    case 'foreach':
      return [e.expr, e.init, e.update, ...(e.extract ? [e.extract] : [])];
    case 'binding':
      return [e.expr, e.next];
    case 'label':
      return [e.next];
  }
}
function Du(e) {
  switch (e.type) {
    case 'dynamic-index':
      return [e.expr];
    case 'slice':
      return [...(e.from ? [e.from] : []), ...(e.to ? [e.to] : [])];
    default:
      return [];
  }
}
var A = class extends Error {
  kind;
  path;
  constructor(t, n, r = {}) {
    (super(n, r.cause === void 0 ? void 0 : { cause: r.cause }),
      (this.name = 'AuthorizationError'),
      (this.kind = t),
      (this.path = r.path));
  }
  toRecord() {
    return {
      kind: this.kind,
      message: this.message,
      ...(this.path === void 0 ? {} : { path: this.path }),
      ...(this.cause === void 0 ? {} : { cause: this.cause }),
    };
  }
};
function Mr(e) {
  return e instanceof A
    ? e.toRecord()
    : {
        kind: 'invalid-model',
        message: e instanceof Error ? e.message : String(e),
        cause: e,
      };
}
function Lu(e, t) {
  switch (t) {
    case 'any':
      return !0;
    case 'bool':
    case 'boolean':
      return typeof e == 'boolean';
    case 'int':
    case 'integer':
      return typeof e == 'number' && Number.isSafeInteger(e);
    case 'double':
    case 'number':
      return typeof e == 'number' && Number.isFinite(e);
    case 'string':
    case 'ipaddress':
      return typeof e == 'string';
    case 'timestamp':
      return typeof e == 'string' && Number.isFinite(Date.parse(e));
    default:
      return !1;
  }
}
function Do(e, t, n) {
  let i = It(t.expression, { profile: 'policy' }).profileIssues.filter(
    (a) => a.severity === 'error',
  );
  if (i.length > 0)
    throw new A(
      'unsafe-expression',
      i.map((a) => `${a.code}: ${a.message}`).join(`
`),
      { path: n },
    );
  let o;
  try {
    o = Lo(t.expression, {
      libraries: ['core', 'authorization'],
      runtimeLimits: { maxSteps: 1e4, maxOutputBytes: 1024 },
    });
  } catch (a) {
    throw new A(
      'invalid-expression',
      `Could not prepare authorization condition ${e}.`,
      { path: n, cause: a },
    );
  }
  let s = t.parameters ?? {};
  return {
    name: e,
    source: t.expression,
    parameters: s,
    evaluate(a, u = {}) {
      let l = { ...a, ...u };
      for (let [d, p] of Object.entries(s)) {
        if (!(d in l))
          throw new A(
            'invalid-model',
            `Condition ${e} is missing required context parameter ${d}.`,
            { path: `context.${d}` },
          );
        if (!Lu(l[d], p))
          throw new A(
            'invalid-model',
            `Condition ${e} parameter ${d} is not a valid ${p}.`,
            { path: `context.${d}` },
          );
      }
      let c;
      try {
        c = o.run(
          { context: l },
          { runtimeLimits: { maxSteps: 1e4, maxOutputBytes: 1024 } },
        ).outputs;
      } catch (d) {
        throw new A('invalid-model', `Condition ${e} evaluation failed.`, {
          path: n,
          cause: d,
        });
      }
      if (c.length !== 1 || typeof c[0] != 'boolean')
        throw new A(
          'invalid-model',
          `Condition ${e} must produce exactly one boolean value.`,
          { path: n },
        );
      return c[0];
    },
  };
}
var Pu = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
function re(e, t) {
  if (!Pu.test(e))
    throw new A(
      'invalid-identifier',
      `Expected a non-empty type/relation name containing only letters, numbers, underscore, or hyphen; received ${JSON.stringify(e)}.`,
      { path: t },
    );
}
function Po(e, t) {
  let n = e.indexOf(':');
  if (n <= 0 || n === e.length - 1)
    throw new A(
      'invalid-identifier',
      `Expected an identifier in type:id form; received ${JSON.stringify(e)}.`,
      { path: t },
    );
  let r = e.slice(0, n),
    i = e.slice(n + 1);
  return (re(r, `${t}.type`), [r, i]);
}
function ne(e, t = 'object') {
  if (e.includes('#'))
    throw new A(
      'invalid-identifier',
      `Object identifiers cannot contain a userset relation: ${JSON.stringify(e)}.`,
      { path: t },
    );
  let [n, r] = Po(e, t);
  return { type: n, id: r, canonical: `${n}:${r}` };
}
function X(e, t = 'subject') {
  let n = e.lastIndexOf('#'),
    r = n === -1 ? e : e.slice(0, n),
    i = n === -1 ? void 0 : e.slice(n + 1),
    [o, s] = Po(r, t);
  if ((i !== void 0 && re(i, `${t}.relation`), s === '*' && i !== void 0))
    throw new A(
      'invalid-identifier',
      'A typed wildcard cannot also be a userset subject.',
      { path: t },
    );
  return {
    type: o,
    id: s,
    ...(i === void 0 ? {} : { relation: i }),
    wildcard: s === '*',
    canonical: `${o}:${s}${i === void 0 ? '' : `#${i}`}`,
  };
}
function fn(e, t = 'subjectType') {
  if (typeof e != 'string') {
    if (
      (re(e.type, `${t}.type`),
      e.relation !== void 0 && re(e.relation, `${t}.relation`),
      e.condition !== void 0 && re(e.condition, `${t}.condition`),
      e.wildcard && e.relation !== void 0)
    )
      throw new A(
        'invalid-identifier',
        'A subject type constraint cannot be both a wildcard and a userset.',
        { path: t },
      );
    return {
      type: e.type,
      ...(e.relation === void 0 ? {} : { relation: e.relation }),
      wildcard: e.wildcard ?? !1,
      ...(e.condition === void 0 ? {} : { condition: e.condition }),
      canonical: e.wildcard
        ? `${e.type}:*`
        : e.relation === void 0
          ? e.type
          : `${e.type}#${e.relation}`,
    };
  }
  let n = e.endsWith(':*'),
    i = (n ? e.slice(0, -2) : e).split('#');
  if (i.length > 2 || i[0] === '' || (n && i.length > 1))
    throw new A(
      'invalid-identifier',
      `Expected a subject type in type or type#relation form; received ${JSON.stringify(e)}.`,
      { path: t },
    );
  let o = i[0],
    s = i[1];
  return (
    re(o, `${t}.type`),
    s !== void 0 && re(s, `${t}.relation`),
    {
      type: o,
      ...(s === void 0 ? {} : { relation: s }),
      wildcard: n,
      canonical: n ? `${o}:*` : s === void 0 ? o : `${o}#${s}`,
    }
  );
}
var mn = 'bxl-authorization-ir/1';
var Fu = new Set(['direct', 'userset', 'userset_from', 'except']);
function Or(e, t) {
  if (e.type !== 'str' || e.interpolated !== !1)
    throw new A(
      'invalid-expression',
      'Authorization graph targets must be literal strings.',
      { path: t },
    );
  return e.value;
}
function hn(e) {
  return e.name.replace(/\/\d+$/, '');
}
function Br(e) {
  return !e || typeof e != 'object'
    ? !1
    : 'type' in e &&
        e.type === 'filter' &&
        'name' in e &&
        typeof e.name == 'string' &&
        Fu.has(e.name.replace(/\/\d+$/, ''))
      ? !0
      : Object.values(e).some((t) => (Array.isArray(t) ? t.some(Br) : Br(t)));
}
function Uu(e, t) {
  let n = t.flatMap((r) => (r.kind === e ? r.children : [r]));
  return { kind: e, children: n };
}
function Rt(e, t) {
  if (e.type === 'binary' && (e.operator === 'or' || e.operator === 'and')) {
    let r = e.operator === 'or' ? 'union' : 'intersection';
    return Uu(r, [Rt(e.left, `${t}.left`), Rt(e.right, `${t}.right`)]);
  }
  if (e.type === 'filter' && hn(e) === 'direct') {
    if (e.args.length !== 0)
      throw new A('invalid-expression', 'direct() accepts no arguments.', {
        path: t,
      });
    return { kind: 'direct' };
  }
  if (e.type === 'filter' && hn(e) === 'userset') {
    if (e.args.length !== 1)
      throw new A(
        'invalid-expression',
        'userset() requires one literal relation name.',
        { path: t },
      );
    return { kind: 'computed', relation: Or(e.args[0], `${t}.args[0]`) };
  }
  if (e.type === 'filter' && hn(e) === 'userset_from') {
    if (e.args.length !== 2)
      throw new A(
        'invalid-expression',
        'userset_from() requires literal tupleset and computed relation names.',
        { path: t },
      );
    return {
      kind: 'tupleToUserset',
      tupleset: Or(e.args[0], `${t}.args[0]`),
      computed: Or(e.args[1], `${t}.args[1]`),
    };
  }
  if (e.type === 'filter' && hn(e) === 'except') {
    if (e.args.length !== 2)
      throw new A(
        'invalid-expression',
        'except() requires base and subtract expressions.',
        { path: t },
      );
    return {
      kind: 'difference',
      base: Rt(e.args[0], `${t}.base`),
      subtract: Rt(e.args[1], `${t}.subtract`),
    };
  }
  if (Br(e))
    throw new A(
      'invalid-expression',
      'Graph calls may only participate in `or`, `and`, or `except()` authorization composition.',
      { path: t },
    );
  let n = Uo(e, { runtimeLimits: { maxSteps: 1e4, maxOutputBytes: 1024 } });
  return {
    kind: 'predicate',
    evaluate(r) {
      let i = r.context.__bxlAuthorization,
        o = i && typeof i == 'object' ? i : void 0,
        s = o
          ? {
              ...r,
              resource: o.resources?.[r.object.canonical],
              input: r.context.input ?? {},
              party: o.parties?.[r.subject.canonical],
              now: r.context.now,
              policy: o.policy ?? {},
            }
          : r,
        a = n.run(s, {
          runtimeLimits: { maxSteps: 1e4, maxOutputBytes: 1024 },
        }).outputs;
      if (a.length !== 1 || typeof a[0] != 'boolean')
        throw new A(
          'invalid-model',
          'An authorization predicate must produce exactly one boolean value.',
          { path: t },
        );
      return a[0];
    },
  };
}
function zu(e) {
  if (Array.isArray(e)) return { subjects: e, rewrite: 'direct()' };
  let t = e,
    n = t.subjects ?? [],
    r = t.rewrite ?? (n.length > 0 ? 'direct()' : '');
  return { subjects: n, rewrite: r };
}
function Fo(e, t, n, r) {
  let i = `types.${e}.${r ? 'relations' : 'permissions'}.${t}`,
    o = r ? zu(n) : { subjects: [], rewrite: n };
  if (o.rewrite.trim() === '')
    throw new A(
      'invalid-model',
      'A relation without directly assignable subjects must declare a rewrite.',
      { path: i },
    );
  let s;
  try {
    s = It(o.rewrite, { profile: 'authorization' });
  } catch (c) {
    throw new A(
      'invalid-expression',
      'Could not parse authorization expression.',
      { path: i, cause: c },
    );
  }
  let a = s.profileIssues.filter((c) => c.severity === 'error');
  if (a.length > 0)
    throw new A(
      'unsafe-expression',
      a.map((c) => `${c.code}: ${c.message}`).join(`
`),
      { path: i },
    );
  if (!s.body)
    throw new A('invalid-expression', 'Authorization expression is empty.', {
      path: i,
    });
  let u = vt(s.canonicalSource, { readableSyntax: !1 });
  if (!u.ast.expr)
    throw new A('invalid-expression', 'Authorization expression is empty.', {
      path: i,
    });
  let l = Rt(u.ast.expr, `${i}.rewrite`);
  if (!r && yn(l, 'direct'))
    throw new A(
      'invalid-model',
      'A permission cannot use direct() because permissions are not tuple-assignable.',
      { path: i },
    );
  return {
    name: t,
    assignable: r,
    allowedSubjects: o.subjects.map((c, d) => fn(c, `${i}.subjects[${d}]`)),
    expression: l,
    source: o.rewrite,
  };
}
function yn(e, t) {
  if (e.kind === t) return !0;
  switch (e.kind) {
    case 'union':
    case 'intersection':
      return e.children.some((n) => yn(n, t));
    case 'difference':
      return yn(e.base, t) || yn(e.subtract, t);
    default:
      return !1;
  }
}
function gn(e, t, n, r) {
  let i = `types.${t.name}.${n.name}`;
  switch (r.kind) {
    case 'computed': {
      if (!t.relations.has(r.relation))
        throw new A(
          'unknown-relation',
          `Unknown relation ${t.name}#${r.relation}.`,
          { path: i },
        );
      return;
    }
    case 'tupleToUserset': {
      let o = t.relations.get(r.tupleset);
      if (!o || !o.assignable)
        throw new A(
          'unknown-relation',
          `Tuple-to-userset source ${t.name}#${r.tupleset} must be an assignable relation.`,
          { path: i },
        );
      for (let s of o.allowedSubjects)
        if (s.relation !== void 0 || s.wildcard)
          throw new A(
            'invalid-model',
            `Tuple-to-userset source ${t.name}#${r.tupleset} cannot target ${s.canonical}; it must target objects.`,
            { path: i },
          );
      return;
    }
    case 'union':
    case 'intersection':
      for (let o of r.children) gn(e, t, n, o);
      return;
    case 'difference':
      (gn(e, t, n, r.base), gn(e, t, n, r.subtract));
      return;
    case 'direct':
    case 'predicate':
      return;
  }
}
function Dr(e) {
  if (!e || typeof e != 'object' || e.schema !== mn)
    throw new A('invalid-model', `Authorization model schema must be ${mn}.`, {
      path: 'schema',
    });
  if (!e.types || typeof e.types != 'object' || Array.isArray(e.types))
    throw new A(
      'invalid-model',
      'Authorization model types must be an object.',
      { path: 'types' },
    );
  let t = new Map(
      Object.entries(e.conditions ?? {}).map(
        ([i, o]) => (
          re(i, `conditions.${i}`),
          [i, Do(i, o, `conditions.${i}`)]
        ),
      ),
    ),
    n = new Map();
  for (let [i, o] of Object.entries(e.types)) {
    re(i, `types.${i}`);
    let s = new Map();
    for (let [a, u] of Object.entries(o.relations ?? {}))
      (re(a, `types.${i}.relations.${a}`), s.set(a, Fo(i, a, u, !0)));
    for (let [a, u] of Object.entries(o.permissions ?? {})) {
      if ((re(a, `types.${i}.permissions.${a}`), s.has(a)))
        throw new A(
          'invalid-model',
          `Relation and permission names collide at ${i}#${a}.`,
          { path: `types.${i}.permissions.${a}` },
        );
      s.set(a, Fo(i, a, u, !1));
    }
    n.set(i, { name: i, relations: s });
  }
  let r = { schema: mn, types: n, conditions: t };
  for (let i of n.values())
    for (let o of i.relations.values()) {
      for (let s of o.allowedSubjects) {
        let a = n.get(s.type);
        if (!a)
          throw new A('unknown-type', `Unknown subject type ${s.type}.`, {
            path: `types.${i.name}.${o.name}`,
          });
        if (s.relation !== void 0 && !a.relations.has(s.relation))
          throw new A(
            'unknown-relation',
            `Unknown userset relation ${s.canonical}.`,
            { path: `types.${i.name}.${o.name}` },
          );
        if (s.condition !== void 0 && !t.has(s.condition))
          throw new A(
            'invalid-model',
            `Unknown authorization condition ${s.condition}.`,
            { path: `types.${i.name}.${o.name}` },
          );
      }
      gn(r, i, o, o.expression);
    }
  return r;
}
/*! @license
 * Synchronous TypeScript adaptation of OpenFGA recursive userset resolution.
 * Upstream: openfga/openfga@2c19e265fc73858fc0a5468fc517dc3bbf727e94
 * Source: internal/graph/recursive_resolver.go
 * Functions adapted: processUsersetMessage, breadthFirstRecursiveMatch
 * Copyright OpenFGA Authors. Licensed under Apache-2.0.
 * https://www.apache.org/licenses/LICENSE-2.0
 */ var Lr = Object.freeze({
  upstream: 'openfga/openfga',
  commit: '2c19e265fc73858fc0a5468fc517dc3bbf727e94',
  source: 'internal/graph/recursive_resolver.go',
  upstreamFunctions: Object.freeze([
    'processUsersetMessage',
    'breadthFirstRecursiveMatch',
  ]),
  portFunctions: Object.freeze([
    'processUsersetMessage',
    'breadthFirstRecursiveMatchSync',
  ]),
  execution: 'synchronous-in-memory',
  license: 'Apache-2.0',
});
function ju(e, t, n) {
  return (t.add(e), n.has(e));
}
function Vu(e, t) {
  let n = [],
    r = e;
  for (; r !== void 0; ) (n.push(r), (r = t.get(r)));
  return n.reverse();
}
function zo(e, t, n) {
  let r = new Set(e),
    i = new Set(),
    o = new Map(),
    s = [],
    a = 0,
    u = 0;
  for (let l of r) o.set(l, void 0);
  for (; r.size > 0; ) {
    if (u > n)
      return {
        matched: !1,
        path: [],
        visited: s,
        cyclePruned: a,
        depthExceeded: !0,
      };
    let l = new Set();
    for (let c of r) {
      if (i.has(c)) {
        a++;
        continue;
      }
      (i.add(c), s.push({ userset: c, depth: u }));
      let d = t(c, u);
      if (d.matched)
        return {
          matched: !0,
          path: Vu(c, o),
          visited: s,
          cyclePruned: a,
          depthExceeded: !1,
        };
      for (let p of d.children) {
        if (ju(p, l, i)) {
          a++;
          continue;
        }
        o.has(p) || o.set(p, c);
      }
    }
    ((r = l), u++);
  }
  return {
    matched: !1,
    path: [],
    visited: s,
    cyclePruned: a,
    depthExceeded: !1,
  };
}
function jo(e, t) {
  return `${e}\0${t}`;
}
function Xu(e, t, n) {
  return (
    e.type === n.type &&
    e.relation === n.relation &&
    e.wildcard === n.wildcard &&
    t === n.condition
  );
}
function Je(e, t, n = {}) {
  let r = [],
    i = new Map(),
    o = new Map();
  for (let s = 0; s < t.length; s++) {
    let a = t[s],
      u = `tuples[${s}]`,
      l,
      c;
    try {
      ((l = ne(a.object, `${u}.object`)), (c = X(a.subject, `${u}.subject`)));
    } catch (m) {
      if (n.invalidTuplePolicy === 'ignore') continue;
      throw m;
    }
    let d = e.types.get(l.type);
    if (!d) {
      if (n.invalidTuplePolicy === 'ignore') continue;
      throw new A('unknown-type', `Unknown object type ${l.type}.`, {
        path: `${u}.object`,
      });
    }
    let p = d.relations.get(a.relation);
    if (!p || !p.assignable) {
      if (n.invalidTuplePolicy === 'ignore') continue;
      throw new A(
        'unknown-relation',
        `Tuple relation ${l.type}#${a.relation} is not assignable.`,
        { path: `${u}.relation` },
      );
    }
    if (!e.types.has(c.type)) {
      if (n.invalidTuplePolicy === 'ignore') continue;
      throw new A('unknown-type', `Unknown subject type ${c.type}.`, {
        path: `${u}.subject`,
      });
    }
    if (!p.allowedSubjects.some((m) => Xu(c, a.condition?.name, m))) {
      if (n.invalidTuplePolicy === 'ignore') continue;
      throw new A(
        'invalid-tuple',
        `Subject ${c.canonical} is not allowed on ${l.type}#${a.relation}.`,
        { path: `${u}.subject` },
      );
    }
    let g = {
      ...a,
      subject: c.canonical,
      object: l.canonical,
      parsedSubject: c,
      parsedObject: l,
    };
    r.push(g);
    let x = jo(l.canonical, a.relation),
      w = i.get(x) ?? [];
    (w.push(g), i.set(x, w));
    let S = o.get(l.type) ?? new Set();
    (S.add(l.canonical), o.set(l.type, S));
  }
  return {
    tuples: r,
    objectsByType: o,
    forObjectRelation(s, a) {
      return i.get(jo(s, a)) ?? [];
    },
  };
}
var Gu = {
  maxDepth: 25,
  maxSteps: 1e4,
  maxTupleReads: 1e5,
  maxTraceEvents: 1e3,
  maxCandidates: 1e5,
  maxResults: 1e5,
};
function Ue() {
  return { status: 'deny' };
}
function Ee() {
  return { status: 'allow' };
}
function Vo() {
  return { status: 'cycle' };
}
function ue(e) {
  return { status: 'error', error: e };
}
function qu(e) {
  let t = { ...Gu, ...e };
  for (let [n, r] of Object.entries(t))
    if (!Number.isSafeInteger(r) || r <= 0)
      throw new A(
        'invalid-model',
        `Authorization runtime limit ${n} must be a positive safe integer.`,
        { path: `limits.${n}` },
      );
  return t;
}
function Yu(e, t, n) {
  return `${e}\0${t}\0${n}`;
}
function Xo(e, t) {
  if (
    (e.metrics.steps++,
    (e.metrics.maxDepth = Math.max(e.metrics.maxDepth, t)),
    t > e.limits.maxDepth)
  )
    return new A(
      'resolution-depth-exceeded',
      `Authorization resolution exceeded maximum depth ${e.limits.maxDepth}.`,
    );
  if (e.metrics.steps > e.limits.maxSteps)
    return new A(
      'evaluation-limit-exceeded',
      `Authorization resolution exceeded maximum steps ${e.limits.maxSteps}.`,
    );
}
function Pr(e, t) {
  !e.trace || e.trace.length >= e.limits.maxTraceEvents || e.trace.push(t);
}
function Fr(e, t, n) {
  let r = e.stored.forObjectRelation(t, n),
    i = e.contextual?.forObjectRelation(t, n) ?? [],
    o = r.length + i.length;
  return (
    (e.metrics.tupleReads += o),
    e.metrics.tupleReads > e.limits.maxTupleReads
      ? new A(
          'evaluation-limit-exceeded',
          `Authorization resolution exceeded maximum tuple reads ${e.limits.maxTupleReads}.`,
        )
      : i.length === 0
        ? r
        : [...r, ...i]
  );
}
function Ur(e) {
  let t,
    n = !1;
  for (let r of e) {
    if (r.status === 'allow') return Ee();
    (r.status === 'error' && !t && (t = r.error),
      r.status === 'cycle' && (n = !0));
  }
  return t ? ue(t) : n ? Vo() : Ue();
}
function Hu(e) {
  let t;
  for (let n of e) {
    if (n.status === 'deny' || n.status === 'cycle') return Ue();
    n.status === 'error' && !t && (t = n.error);
  }
  return t ? ue(t) : Ee();
}
function Wu(e, t) {
  return e.status === 'deny' ||
    e.status === 'cycle' ||
    t.status === 'allow' ||
    t.status === 'cycle'
    ? Ue()
    : e.status === 'allow' && t.status === 'deny'
      ? Ee()
      : e.status === 'error'
        ? e
        : t.status === 'error'
          ? t
          : Ue();
}
function Go(e, t) {
  return e.parsedSubject.canonical === t.canonical
    ? !0
    : e.parsedSubject.relation !== void 0 || e.parsedSubject.type !== t.type
      ? !1
      : e.parsedSubject.id === '*' || e.parsedSubject.id === t.id;
}
function Tt(e, t, n) {
  if (!t.condition) return Ee();
  let r = e.conditions.get(t.condition.name);
  if (!r)
    return ue(
      new A(
        'invalid-model',
        `Tuple condition ${t.condition.name} does not exist in the active model.`,
      ),
    );
  try {
    return r.evaluate(n.context, t.condition.context) ? Ee() : Ue();
  } catch (i) {
    return ue(
      i instanceof A
        ? i
        : new A(
            'invalid-model',
            `Tuple condition ${t.condition.name} evaluation failed.`,
            { cause: i },
          ),
    );
  }
}
function Ku(e, t, n, r, i) {
  try {
    let o = zo(
      t,
      (u, l) => {
        let c = X(u, 'recursive.userset');
        if (c.relation === void 0) return { matched: !1, children: [] };
        let d = ne(`${c.type}:${c.id}`),
          p = e.types.get(d.type)?.relations.get(c.relation);
        if (!p)
          throw new A(
            'unknown-relation',
            `Unknown recursive userset relation ${u}.`,
          );
        if (p.expression.kind !== 'direct') {
          let S = Nt(e, d, c.relation, n, new Set(r), i + l);
          if (S.status === 'error') throw S.error;
          return { matched: S.status === 'allow', children: [] };
        }
        let g = Xo(n, i + l);
        if (g) throw g;
        let x = Fr(n, d.canonical, c.relation);
        if (x instanceof A) throw x;
        let w = [];
        for (let S of x) {
          if (Go(S, n.subject)) {
            let m = Tt(e, S, n);
            if (m.status === 'error') throw m.error;
            if (m.status === 'allow') return { matched: !0, children: w };
            continue;
          }
          if (S.parsedSubject.relation !== void 0) {
            let m = Tt(e, S, n);
            if (m.status === 'error') throw m.error;
            m.status === 'allow' && w.push(S.parsedSubject.canonical);
          }
        }
        return { matched: !1, children: w };
      },
      Math.max(0, n.limits.maxDepth - i),
    );
    if (o.depthExceeded)
      return ue(
        new A(
          'resolution-depth-exceeded',
          `Authorization resolution exceeded maximum depth ${n.limits.maxDepth}.`,
        ),
      );
    let s =
        `OpenFGA ${Lr.upstreamFunctions[1]} synchronous port @ ${Lr.commit.slice(0, 12)}` +
        (o.cyclePruned > 0 ? `; ${o.cyclePruned} revisits pruned` : ''),
      a = o.matched
        ? o.path.map((u, l) => ({ userset: u, depth: l }))
        : o.visited;
    for (let u of [...a].reverse()) {
      let l = X(u.userset, 'recursive.trace');
      Pr(n, {
        depth: i + u.depth,
        operation: 'openfga-recursive-userset',
        subject: n.subject.canonical,
        relation: l.relation ?? 'userset',
        object: `${l.type}:${l.id}`,
        outcome: o.matched ? 'allow' : 'deny',
        detail: s,
      });
    }
    return o.matched ? Ee() : Ue();
  } catch (o) {
    return ue(
      o instanceof A
        ? o
        : new A('invalid-model', 'OpenFGA recursive userset port failed.', {
            cause: o,
          }),
    );
  }
}
function Ju(e, t, n, r, i, o) {
  let s = Fr(r, t.canonical, n);
  if (s instanceof A) return ue(s);
  let a = [],
    u = [];
  for (let l of s) {
    if (Go(l, r.subject)) {
      let c = Tt(e, l, r);
      if (c.status === 'allow') return Ee();
      (c.status === 'error' || c.status === 'cycle') && a.push(c);
      continue;
    }
    if (l.parsedSubject.relation !== void 0) {
      let c = Tt(e, l, r);
      if (c.status === 'deny') continue;
      if (c.status === 'error' || c.status === 'cycle') {
        a.push(c);
        continue;
      }
      let d = ne(`${l.parsedSubject.type}:${l.parsedSubject.id}`);
      e.types.get(d.type)?.relations.get(l.parsedSubject.relation)?.expression
        .kind === 'direct'
        ? u.push(l.parsedSubject.canonical)
        : a.push(Nt(e, d, l.parsedSubject.relation, r, new Set(i), o + 1));
    }
  }
  if (u.length > 0) {
    for (let l of u)
      if ((a.push(Ku(e, [l], r, i, o + 1)), a.at(-1)?.status === 'allow'))
        break;
  }
  return Ur(a);
}
function Zu(e, t, n, r, i, o) {
  let s = Fr(r, n.canonical, t.tupleset);
  if (s instanceof A) return ue(s);
  let a = [];
  for (let u of s) {
    if (u.parsedSubject.wildcard || u.parsedSubject.relation !== void 0)
      continue;
    let l = Tt(e, u, r);
    if (l.status === 'deny') continue;
    if (l.status === 'error' || l.status === 'cycle') {
      a.push(l);
      continue;
    }
    let c = ne(`${u.parsedSubject.type}:${u.parsedSubject.id}`);
    e.types.get(c.type)?.relations.has(t.computed) &&
      a.push(Nt(e, c, t.computed, r, new Set(i), o + 1));
  }
  return Ur(a);
}
function St(e, t, n, r, i, o, s) {
  switch (t.kind) {
    case 'direct':
      return Ju(e, n, r, i, o, s);
    case 'computed':
      return Nt(e, n, t.relation, i, new Set(o), s + 1);
    case 'tupleToUserset':
      return Zu(e, t, n, i, o, s);
    case 'union': {
      let a = [];
      for (let u of t.children) {
        let l = St(e, u, n, r, i, new Set(o), s);
        if ((a.push(l), l.status === 'allow')) break;
      }
      return Ur(a);
    }
    case 'intersection': {
      let a = [];
      for (let u of t.children) {
        let l = St(e, u, n, r, i, new Set(o), s);
        if ((a.push(l), l.status === 'deny' || l.status === 'cycle')) break;
      }
      return Hu(a);
    }
    case 'difference':
      return Wu(
        St(e, t.base, n, r, i, new Set(o), s),
        St(e, t.subtract, n, r, i, new Set(o), s),
      );
    case 'predicate':
      try {
        return t.evaluate({
          context: i.context,
          subject: i.subject,
          object: n,
          relation: r,
        })
          ? Ee()
          : Ue();
      } catch (a) {
        return ue(
          a instanceof A
            ? a
            : new A(
                'invalid-model',
                'BXL authorization predicate evaluation failed.',
                { cause: a },
              ),
        );
      }
  }
}
function Nt(e, t, n, r, i, o) {
  let s = Xo(r, o);
  if (s) return ue(s);
  let u = e.types.get(t.type)?.relations.get(n);
  if (!u)
    return ue(new A('unknown-relation', `Unknown relation ${t.type}#${n}.`));
  let l = Yu(r.subject.canonical, t.canonical, n);
  if (i.has(l))
    return (
      Pr(r, {
        depth: o,
        operation: 'cycle',
        subject: r.subject.canonical,
        relation: n,
        object: t.canonical,
        outcome: 'deny',
        detail: 'repeated relation path',
      }),
      Vo()
    );
  let c = new Set(i);
  c.add(l);
  let d = St(e, u.expression, t, n, r, c, o);
  return (
    Pr(r, {
      depth: o,
      operation: u.expression.kind,
      subject: r.subject.canonical,
      relation: n,
      object: t.canonical,
      outcome: d.status === 'cycle' ? 'deny' : d.status,
      ...(d.status === 'error' ? { detail: d.error.message } : {}),
    }),
    d
  );
}
function Et(e, t, n) {
  try {
    let r = X(n.subject, 'request.subject'),
      i = ne(n.object, 'request.object');
    if (!e.types.has(r.type))
      throw new A('unknown-type', `Unknown subject type ${r.type}.`, {
        path: 'request.subject',
      });
    if (
      r.relation !== void 0 &&
      !e.types.get(r.type)?.relations.get(r.relation)
    )
      throw new A(
        'unknown-relation',
        `Unknown userset relation ${r.type}#${r.relation}.`,
        { path: 'request.subject' },
      );
    let o = e.types.get(i.type);
    if (!o)
      throw new A('unknown-type', `Unknown object type ${i.type}.`, {
        path: 'request.object',
      });
    if (!o.relations.has(n.relation))
      throw new A(
        'unknown-relation',
        `Unknown relation ${i.type}#${n.relation}.`,
        { path: 'request.relation' },
      );
    let s = { steps: 0, tupleReads: 0, maxDepth: 0 },
      a = {
        subject: r,
        context: n.context ?? {},
        stored: t,
        ...(n.contextualTuples && n.contextualTuples.length > 0
          ? { contextual: Je(e, n.contextualTuples) }
          : {}),
        limits: qu(n.limits),
        metrics: s,
        ...(n.trace ? { trace: [] } : {}),
      },
      u = Nt(e, i, n.relation, a, new Set(), 0);
    return u.status === 'error'
      ? { ok: !1, error: u.error.toRecord() }
      : {
          ok: !0,
          value: {
            allowed: u.status === 'allow',
            metrics: s,
            trace: a.trace ?? [],
          },
        };
  } catch (r) {
    return {
      ok: !1,
      error:
        r instanceof A
          ? r.toRecord()
          : new A('invalid-model', r instanceof Error ? r.message : String(r), {
              cause: r,
            }).toRecord(),
    };
  }
}
function qo() {
  return { steps: 0, tupleReads: 0, maxDepth: 0 };
}
function Qu(e, t) {
  ((e.steps += t.steps),
    (e.tupleReads += t.tupleReads),
    (e.maxDepth = Math.max(e.maxDepth, t.maxDepth)));
}
function Yo(e) {
  return [...e].sort((t, n) => (t < n ? -1 : t > n ? 1 : 0));
}
function Ho(e, t) {
  return t && t.length > 0 ? Je(e, t) : void 0;
}
function el(e, t) {
  let n = X(t, 'request.subject'),
    r = e.types.get(n.type);
  if (!r)
    throw new A('unknown-type', `Unknown subject type ${n.type}.`, {
      path: 'request.subject',
    });
  if (n.relation !== void 0 && !r.relations.has(n.relation))
    throw new A(
      'unknown-relation',
      `Unknown userset relation ${n.type}#${n.relation}.`,
      { path: 'request.subject' },
    );
}
function wn(e, t, n, r) {
  let i = e.forObjectRelation(n, r),
    o = t?.forObjectRelation(n, r) ?? [];
  return o.length === 0 ? i : [...i, ...o];
}
function An(e, t, n) {
  if (!t.condition) return !0;
  let r = e.conditions.get(t.condition.name);
  if (!r)
    throw new A(
      'invalid-model',
      `Tuple condition ${t.condition.name} does not exist in the active model.`,
    );
  return r.evaluate(n, t.condition.context);
}
function ze(e, t, n) {
  let r = e ?? t;
  if (!Number.isSafeInteger(r) || r <= 0)
    throw new A(
      'invalid-model',
      `Authorization runtime limit ${n} must be a positive safe integer.`,
      { path: `limits.${n}` },
    );
  return r;
}
function Wo(e) {
  if ((e.metrics.steps++, e.metrics.steps > e.maxSteps))
    throw new A(
      'evaluation-limit-exceeded',
      `Authorization enumeration exceeded maximum steps ${e.maxSteps}.`,
    );
}
function In(e) {
  if ((e.metrics.tupleReads++, e.metrics.tupleReads > e.maxTupleReads))
    throw new A(
      'evaluation-limit-exceeded',
      `Authorization enumeration exceeded maximum tuple reads ${e.maxTupleReads}.`,
    );
}
function je(e = []) {
  return { values: new Set(e), wildcardExclusions: new Map() };
}
function Ko(e) {
  return new Set(
    [...e.values]
      .map((t) => X(t))
      .filter((t) => t.wildcard)
      .map((t) => t.type),
  );
}
function zr(e) {
  let t = je();
  for (let n of e) for (let r of n.values) t.values.add(r);
  for (let n of Ko(t)) {
    let r = e.filter((o) => o.values.has(`${n}:*`)),
      i = new Set(r[0]?.wildcardExclusions.get(n) ?? []);
    for (let o of r.slice(1)) {
      let s = o.wildcardExclusions.get(n) ?? new Set();
      i = new Set([...i].filter((a) => s.has(a)));
    }
    for (let o of e)
      for (let s of o.values) {
        let a = X(s);
        a.type === n && !a.wildcard && a.relation === void 0 && i.delete(s);
      }
    i.size > 0 && t.wildcardExclusions.set(n, i);
  }
  return t;
}
function tl(e, t) {
  if (e === t) return e;
  let n = X(e),
    r = X(t);
  if (!(n.relation !== void 0 || r.relation !== void 0 || n.type !== r.type)) {
    if (n.wildcard) return t;
    if (r.wildcard) return e;
  }
}
function nl(e) {
  if (e.length === 0) return je();
  let t = {
    values: new Set(e[0].values),
    wildcardExclusions: new Map(
      [...e[0].wildcardExclusions].map(([n, r]) => [n, new Set(r)]),
    ),
  };
  for (let n of e.slice(1)) {
    let r = new Set();
    for (let o of t.values)
      for (let s of n.values) {
        let a = tl(o, s);
        if (a === void 0) continue;
        let u = X(a);
        !t.wildcardExclusions.get(u.type)?.has(a) &&
          !n.wildcardExclusions.get(u.type)?.has(a) &&
          r.add(a);
      }
    let i = new Map();
    for (let o of Ko(je(r)))
      i.set(
        o,
        new Set([
          ...(t.wildcardExclusions.get(o) ?? []),
          ...(n.wildcardExclusions.get(o) ?? []),
        ]),
      );
    t = { values: r, wildcardExclusions: i };
  }
  return t;
}
function rl(e, t) {
  let n = {
    values: new Set(),
    wildcardExclusions: new Map(
      [...e.wildcardExclusions].map(([r, i]) => [r, new Set(i)]),
    ),
  };
  for (let r of e.values) {
    let i = X(r);
    if (i.wildcard) {
      if (t.values.has(r)) continue;
      n.values.add(r);
      let s = n.wildcardExclusions.get(i.type) ?? new Set();
      for (let a of t.values) {
        let u = X(a);
        u.type === i.type && !u.wildcard && u.relation === void 0 && s.add(a);
      }
      s.size > 0 && n.wildcardExclusions.set(i.type, s);
      continue;
    }
    [...t.values].some((s) => {
      let a = X(s);
      return (
        a.canonical === i.canonical ||
        (a.wildcard &&
          i.relation === void 0 &&
          a.type === i.type &&
          !t.wildcardExclusions.get(a.type)?.has(i.canonical))
      );
    }) || n.values.add(r);
  }
  return n;
}
function kt(e, t, n, r) {
  switch ((Wo(r), e.kind)) {
    case 'direct': {
      let i = je();
      for (let o of wn(r.stored, r.contextual, t.canonical, n))
        if ((In(r), !!An(r.model, o, r.context)))
          if (o.parsedSubject.relation === void 0) i.values.add(o.subject);
          else {
            let s = ne(`${o.parsedSubject.type}:${o.parsedSubject.id}`);
            i = zr([i, bn(s, o.parsedSubject.relation, r)]);
          }
      return i;
    }
    case 'computed':
      return bn(t, e.relation, r);
    case 'tupleToUserset': {
      let i = [];
      for (let o of wn(r.stored, r.contextual, t.canonical, e.tupleset)) {
        if (
          (In(r),
          o.parsedSubject.wildcard ||
            o.parsedSubject.relation !== void 0 ||
            !An(r.model, o, r.context))
        )
          continue;
        let s = ne(`${o.parsedSubject.type}:${o.parsedSubject.id}`);
        r.model.types.get(s.type)?.relations.has(e.computed) &&
          i.push(bn(s, e.computed, r));
      }
      return zr(i);
    }
    case 'union':
      return zr(e.children.map((i) => kt(i, t, n, r)));
    case 'intersection':
      return nl(e.children.map((i) => kt(i, t, n, r)));
    case 'difference':
      return rl(kt(e.base, t, n, r), kt(e.subtract, t, n, r));
    case 'predicate':
      return je(
        [...r.candidateSubjects].filter((i) => {
          let o = X(i);
          return e.evaluate({
            context: r.context,
            subject: o,
            object: t,
            relation: n,
          });
        }),
      );
  }
}
function bn(e, t, n) {
  let r = `${e.canonical}\0${t}`;
  if (n.depth > n.maxDepth)
    throw new A(
      'resolution-depth-exceeded',
      `Authorization resolution exceeded maximum depth ${n.maxDepth}.`,
    );
  if (
    ((n.metrics.maxDepth = Math.max(n.metrics.maxDepth, n.depth)),
    n.visited.has(r))
  )
    return je();
  let i = n.model.types.get(e.type)?.relations.get(t);
  if (!i) return je();
  let o = n.visited,
    s = n.depth;
  ((n.visited = new Set(o).add(r)), n.depth++);
  try {
    return kt(i.expression, e, t, n);
  } finally {
    ((n.visited = o), (n.depth = s));
  }
}
function jr(e, t, n, r, i) {
  switch ((Wo(r), e.kind)) {
    case 'direct':
      for (let o of wn(r.stored, r.contextual, t.canonical, n))
        (In(r),
          !(
            o.parsedSubject.relation === void 0 || !An(r.model, o, r.context)
          ) &&
            xn(
              ne(`${o.parsedSubject.type}:${o.parsedSubject.id}`),
              o.parsedSubject.relation,
              r,
              i,
            ));
      return;
    case 'computed':
      xn(t, e.relation, r, i);
      return;
    case 'tupleToUserset':
      for (let o of wn(r.stored, r.contextual, t.canonical, e.tupleset)) {
        if (
          (In(r),
          o.parsedSubject.wildcard ||
            o.parsedSubject.relation !== void 0 ||
            !An(r.model, o, r.context))
        )
          continue;
        let s = ne(`${o.parsedSubject.type}:${o.parsedSubject.id}`);
        r.model.types.get(s.type)?.relations.has(e.computed) &&
          xn(s, e.computed, r, i);
      }
      return;
    case 'union':
      for (let o of e.children) jr(o, t, n, r, i);
      return;
    case 'intersection':
      return;
    case 'difference':
      jr(e.base, t, n, r, i);
      return;
    case 'predicate':
      throw new A(
        'unsupported-expression',
        'BXL predicate leaves are not executable during userset expansion yet.',
      );
  }
}
function xn(e, t, n, r) {
  let i = `${e.canonical}\0${t}`;
  if ((r.add(`${e.canonical}#${t}`), n.depth > n.maxDepth))
    throw new A(
      'resolution-depth-exceeded',
      `Authorization resolution exceeded maximum depth ${n.maxDepth}.`,
    );
  if (
    ((n.metrics.maxDepth = Math.max(n.metrics.maxDepth, n.depth)),
    n.visited.has(i))
  )
    return;
  let o = n.model.types.get(e.type)?.relations.get(t);
  if (!o) return;
  let s = n.visited,
    a = n.depth;
  ((n.visited = new Set(s).add(i)), n.depth++);
  try {
    jr(o.expression, e, t, n, r);
  } finally {
    ((n.visited = s), (n.depth = a));
  }
}
function Jo(e, t, n) {
  try {
    el(e, n.subject);
    let r = e.types.get(n.type);
    if (!r)
      throw new A('unknown-type', `Unknown object type ${n.type}.`, {
        path: 'request.type',
      });
    if (!r.relations.has(n.relation))
      throw new A(
        'unknown-relation',
        `Unknown relation ${n.type}#${n.relation}.`,
        { path: 'request.relation' },
      );
    let i = Ho(e, n.contextualTuples),
      o = new Set(t.objectsByType.get(n.type) ?? []);
    for (let c of i?.objectsByType.get(n.type) ?? []) o.add(c);
    let s = ze(n.limits?.maxCandidates, 1e5, 'maxCandidates'),
      a = ze(n.limits?.maxResults, 1e5, 'maxResults');
    if (o.size > s)
      throw new A(
        'evaluation-limit-exceeded',
        `Authorization enumeration exceeded maximum candidates ${s}.`,
      );
    let u = [],
      l = qo();
    for (let c of Yo(o)) {
      let d = Et(e, t, {
        subject: n.subject,
        relation: n.relation,
        object: c,
        ...(n.context ? { context: n.context } : {}),
        ...(n.contextualTuples ? { contextualTuples: n.contextualTuples } : {}),
        ...(n.limits ? { limits: n.limits } : {}),
      });
      if (!d.ok) return d;
      if (
        (Qu(l, d.value.metrics), d.value.allowed && (u.push(c), u.length > a))
      )
        throw new A(
          'evaluation-limit-exceeded',
          `Authorization enumeration exceeded maximum results ${a}.`,
        );
    }
    return { ok: !0, value: { objects: u, metrics: l } };
  } catch (r) {
    return {
      ok: !1,
      error:
        r instanceof A
          ? r.toRecord()
          : new A('invalid-model', r instanceof Error ? r.message : String(r), {
              cause: r,
            }).toRecord(),
    };
  }
}
function Zo(e, t, n) {
  try {
    let r = ne(n.object, 'request.object'),
      i = e.types.get(r.type);
    if (!i)
      throw new A('unknown-type', `Unknown object type ${r.type}.`, {
        path: 'request.object',
      });
    if (!i.relations.has(n.relation))
      throw new A(
        'unknown-relation',
        `Unknown relation ${r.type}#${n.relation}.`,
        { path: 'request.relation' },
      );
    let o = n.filters.map((w, S) => {
        let m = fn(w, `request.filters[${S}]`),
          T = e.types.get(m.type);
        if (!T)
          throw new A('unknown-type', `Unknown filter type ${m.type}.`, {
            path: `request.filters[${S}]`,
          });
        if (m.relation !== void 0 && !T.relations.has(m.relation))
          throw new A(
            'unknown-relation',
            `Unknown filter userset ${m.type}#${m.relation}.`,
            { path: `request.filters[${S}]` },
          );
        return m;
      }),
      s = Ho(e, n.contextualTuples),
      a = qo(),
      u = ze(n.limits?.maxCandidates, 1e5, 'maxCandidates'),
      l = ze(n.limits?.maxResults, 1e5, 'maxResults'),
      c = {
        model: e,
        stored: t,
        ...(s ? { contextual: s } : {}),
        context: n.context ?? {},
        visited: new Set(),
        metrics: a,
        depth: 0,
        maxDepth: ze(n.limits?.maxDepth, 25, 'maxDepth'),
        maxSteps: ze(n.limits?.maxSteps, 1e4, 'maxSteps'),
        maxTupleReads: ze(n.limits?.maxTupleReads, 1e5, 'maxTupleReads'),
        candidateSubjects: new Set([
          ...t.tuples.map((w) => w.subject),
          ...(s?.tuples.map((w) => w.subject) ?? []),
          ...o.filter((w) => w.relation === void 0).map((w) => `${w.type}:*`),
        ]),
      },
      p = bn(r, n.relation, c).values;
    for (let w of [...p]) {
      let S = X(w);
      o.some((m) => m.type === S.type && m.relation === S.relation) ||
        p.delete(w);
    }
    let g = new Set();
    o.some((w) => w.relation !== void 0) &&
      xn(r, n.relation, { ...c, visited: new Set() }, g);
    for (let w of g) {
      let S = X(w);
      o.some((m) => m.type === S.type && m.relation === S.relation) && p.add(w);
    }
    if (p.size > u)
      throw new A(
        'evaluation-limit-exceeded',
        `Authorization enumeration exceeded maximum candidates ${u}.`,
      );
    let x = Yo(p);
    if (x.length > l)
      throw new A(
        'evaluation-limit-exceeded',
        `Authorization enumeration exceeded maximum results ${l}.`,
      );
    return { ok: !0, value: { users: x, metrics: a } };
  } catch (r) {
    return {
      ok: !1,
      error:
        r instanceof A
          ? r.toRecord()
          : new A('invalid-model', r instanceof Error ? r.message : String(r), {
              cause: r,
            }).toRecord(),
    };
  }
}
function Vr(e, t = [], n = {}) {
  try {
    let r = Dr(e),
      i = Je(r, t, n);
    return {
      ok: !0,
      value: {
        model: r,
        tupleIndex: i,
        check(o) {
          return Et(r, i, o);
        },
        checkMany(o) {
          return o.map((s) => Et(r, i, s));
        },
        listObjects(o) {
          return Jo(r, i, o);
        },
        listUsers(o) {
          return Zo(r, i, o);
        },
      },
    };
  } catch (r) {
    return { ok: !1, error: Mr(r) };
  }
}
function Qo(e) {
  if (typeof e != 'string') return;
  let t = e.split('.');
  if (t.length !== 4) return;
  let n = 0;
  for (let r of t) {
    if (!/^\d{1,3}$/.test(r)) return;
    let i = Number(r);
    if (i < 0 || i > 255) return;
    n = ((n << 8) | i) >>> 0;
  }
  return n;
}
function il(e, t) {
  if (typeof t != 'string') return !1;
  let n = t.lastIndexOf('/');
  if (n <= 0 || n === t.length - 1) return !1;
  let r = Qo(t.slice(0, n)),
    i = Qo(e),
    o = Number(t.slice(n + 1));
  if (r === void 0 || i === void 0 || !Number.isInteger(o) || o < 0 || o > 32)
    return !1;
  let s = o === 0 ? 0 : (4294967295 << (32 - o)) >>> 0;
  return (i & s) >>> 0 === (r & s) >>> 0;
}
function es(e) {
  return { ok: !1, error: { kind: 'invalid-model', message: e } };
}
function ol(e, t) {
  return !e || typeof e != 'object' || Array.isArray(e)
    ? es('auth_* model must be an object.')
    : Array.isArray(t)
      ? { ok: !0, model: e, tuples: t }
      : es('auth_* tuples must be an array.');
}
function vn(e, t, n) {
  let r = ol(e, t);
  if (!r.ok) return r;
  let i = Vr(r.model, r.tuples);
  return i.ok ? n(i.value) : i;
}
var sl = {
    'auth_check/3': function* (e, t, n, r) {
      let i = vn(t, n, (o) => o.check(r));
      yield i.ok ? i.value.allowed : !1;
    },
    'auth_check_result/3': function* (e, t, n, r) {
      yield vn(t, n, (i) => i.check(r));
    },
    'auth_list_objects/3': function* (e, t, n, r) {
      yield vn(t, n, (i) => i.listObjects(r));
    },
    'auth_list_users/3': function* (e, t, n, r) {
      yield vn(t, n, (i) => i.listUsers(r));
    },
    'ip_in_cidr/2': function* (e, t, n) {
      yield il(t, n);
    },
  },
  ts = Re(sl);
var ns = { jq: {}, native: ts };
var al = { jq: Zi, native: To },
  ul = { ...Kt, authorization: ns, formula: al },
  Ze = ['core', 'formula'],
  rs = new Map();
function ll(e) {
  return [...new Set(e)].join('\0');
}
function Rn(e = Ze) {
  let t = ll(e),
    n = rs.get(t);
  return (n || ((n = ir(ul, [...new Set(e)])), rs.set(t, n)), n);
}
var Xr = [
  'BETA_DIST',
  'BETA_INV',
  'BINOM_DIST',
  'BINOM_DIST_RANGE',
  'BINOM_INV',
  'CHISQ_DIST',
  'CHISQ_DIST_RT',
  'CHISQ_INV',
  'CHISQ_INV_RT',
  'CHISQ_TEST',
  'CONFIDENCE_NORM',
  'CONFIDENCE_T',
  'EXPON_DIST',
  'F_DIST',
  'F_DIST_RT',
  'F_INV',
  'F_INV_RT',
  'F_TEST',
  'GAMMA',
  'GAMMA_DIST',
  'GAMMA_INV',
  'GAMMALN',
  'GAMMALN_PRECISE',
  'GAUSS',
  'HYPGEOM_DIST',
  'LOGNORM_DIST',
  'LOGNORM_INV',
  'NEGBINOM_DIST',
  'NORM_DIST',
  'NORM_INV',
  'NORM_S_DIST',
  'NORM_S_INV',
  'PHI',
  'POISSON_DIST',
  'STANDARDIZE',
  'T_DIST',
  'T_DIST_2T',
  'T_DIST_RT',
  'T_INV',
  'T_INV_2T',
  'T_TEST',
  'WEIBULL_DIST',
  'Z_TEST',
];
var cl = new Map([
    ['BETA.DIST', 'BETA_DIST'],
    ['BETA.INV', 'BETA_INV'],
    ['BINOM.DIST.RANGE', 'BINOM_DIST_RANGE'],
    ['BINOM.DIST', 'BINOM_DIST'],
    ['BINOM.INV', 'BINOM_INV'],
    ['CHISQ.DIST.RT', 'CHISQ_DIST_RT'],
    ['CHISQ.DIST', 'CHISQ_DIST'],
    ['CHISQ.INV.RT', 'CHISQ_INV_RT'],
    ['CHISQ.INV', 'CHISQ_INV'],
    ['CHISQ.TEST', 'CHISQ_TEST'],
    ['CONFIDENCE.NORM', 'CONFIDENCE_NORM'],
    ['CONFIDENCE.T', 'CONFIDENCE_T'],
    ['EXPON.DIST', 'EXPON_DIST'],
    ['F.DIST.RT', 'F_DIST_RT'],
    ['F.DIST', 'F_DIST'],
    ['F.INV.RT', 'F_INV_RT'],
    ['F.INV', 'F_INV'],
    ['F.TEST', 'F_TEST'],
    ['GAMMA.DIST', 'GAMMA_DIST'],
    ['GAMMA.INV', 'GAMMA_INV'],
    ['GAMMALN.PRECISE', 'GAMMALN_PRECISE'],
    ['HYPGEOM.DIST', 'HYPGEOM_DIST'],
    ['LOGNORM.DIST', 'LOGNORM_DIST'],
    ['LOGNORM.INV', 'LOGNORM_INV'],
    ['NEGBINOM.DIST', 'NEGBINOM_DIST'],
    ['NORM.S.DIST', 'NORM_S_DIST'],
    ['NORM.S.INV', 'NORM_S_INV'],
    ['NORM.DIST', 'NORM_DIST'],
    ['NORM.INV', 'NORM_INV'],
    ['POISSON.DIST', 'POISSON_DIST'],
    ['T.DIST.2T', 'T_DIST_2T'],
    ['T.DIST.RT', 'T_DIST_RT'],
    ['T.DIST', 'T_DIST'],
    ['T.INV.2T', 'T_INV_2T'],
    ['T.INV', 'T_INV'],
    ['T.TEST', 'T_TEST'],
    ['WEIBULL.DIST', 'WEIBULL_DIST'],
    ['Z.TEST', 'Z_TEST'],
  ]),
  pl = [...cl.entries()].sort((e, t) => t[0].length - e[0].length),
  Yf = new Set(Xr);
function is(e) {
  return !!(e && /[A-Za-z0-9_]/.test(e));
}
function dl(e, t) {
  let n = t;
  for (; /\s/.test(e[n] ?? ''); ) n++;
  return e[n] === '(';
}
function fl(e, t) {
  let n = !1,
    r = !1,
    i = !1;
  for (let o = 0; o < e.length; o++) {
    let s = e[o];
    if (i) {
      s ===
        `
` && (i = !1);
      continue;
    }
    if (n) {
      r ? (r = !1) : s === '\\' ? (r = !0) : s === '"' && (n = !1);
      continue;
    }
    if (s === '#') {
      i = !0;
      continue;
    }
    if (s === '"') {
      n = !0;
      continue;
    }
    if (!is(e[o - 1])) {
      for (let [a, u] of pl)
        if (
          e.slice(o, o + a.length).toUpperCase() === a &&
          !is(e[o + a.length]) &&
          dl(e, o + a.length)
        ) {
          (t({ start: o, end: o + a.length, replacement: u }),
            (o += a.length - 1));
          break;
        }
    }
  }
}
function os(e) {
  let t = [];
  if (
    (fl(e, (i) => {
      i.replacement &&
        t.push({ start: i.start, end: i.end, replacement: i.replacement });
    }),
    t.length === 0)
  )
    return { source: e, changed: !1 };
  let n = '',
    r = 0;
  for (let i of t) ((n += e.slice(r, i.start) + i.replacement), (r = i.end));
  return ((n += e.slice(r)), { source: n, changed: !0 });
}
var Gr = ['BESSELI', 'BESSELJ', 'BESSELK', 'BESSELY'];
var Wf = new Set(Gr);
var ml = [
  'BASE',
  'BIN2DEC',
  'BIN2HEX',
  'BIN2OCT',
  'BITAND',
  'BITLSHIFT',
  'BITOR',
  'BITRSHIFT',
  'BITXOR',
  'COMPLEX',
  'CONVERT',
  'DEC2BIN',
  'DEC2HEX',
  'DEC2OCT',
  'DECIMAL',
  'DELTA',
  'ERF',
  'ERFC',
  'GESTEP',
  'HEX2BIN',
  'HEX2DEC',
  'HEX2OCT',
  'IMABS',
  'IMAGINARY',
  'IMARGUMENT',
  'IMCONJUGATE',
  'IMCOS',
  'IMCOSH',
  'IMCOT',
  'IMCSC',
  'IMCSCH',
  'IMDIV',
  'IMEXP',
  'IMLN',
  'IMLOG10',
  'IMLOG2',
  'IMPOWER',
  'IMPRODUCT',
  'IMREAL',
  'IMSEC',
  'IMSECH',
  'IMSIN',
  'IMSINH',
  'IMSQRT',
  'IMSUB',
  'IMSUM',
  'IMTAN',
  'OCT2BIN',
  'OCT2DEC',
  'OCT2HEX',
  'UNICHAR',
];
var Jf = new Set(ml);
var hl = [
  'ACCRINT',
  'COUPDAYS',
  'CUMIPMT',
  'CUMPRINC',
  'DB',
  'DDB',
  'DISC',
  'DOLLARDE',
  'DOLLARFR',
  'EFFECT',
  'FV',
  'FVSCHEDULE',
  'IPMT',
  'IRR',
  'IRR_BY',
  'ISPMT',
  'MIRR',
  'NOMINAL',
  'NPER',
  'NPV',
  'NPV_BY',
  'PDURATION',
  'PMT',
  'PPMT',
  'PRICEDISC',
  'PV',
  'RATE',
  'RRI',
  'SLN',
  'SYD',
  'TBILLEQ',
  'TBILLPRICE',
  'TBILLYIELD',
  'XIRR',
  'XIRR_BY',
  'XNPV',
  'XNPV_BY',
];
var Qf = new Set(hl);
cn();
var be = new Set([
    'and',
    'as',
    'break',
    'catch',
    'def',
    'elif',
    'else',
    'end',
    'foreach',
    'if',
    'label',
    'not',
    'or',
    'reduce',
    'then',
    'try',
  ]),
  _t = new Set(['true', 'false', 'null']);
cn();
var L = class extends Error {
    constructor(t) {
      (super(t), (this.name = 'ReadableSyntaxError'));
    }
  },
  yl = new Set([
    'ABS',
    'ACCRINT',
    'ACOS',
    'ACOSH',
    'ACOT',
    'ACOTH',
    'AND',
    'ARABIC',
    'ASIN',
    'ASINH',
    'ATAN',
    'ATAN2',
    'ATANH',
    'AVEDEV',
    'AVERAGE',
    'AVERAGEIF',
    'AVERAGEIFS_BY',
    'AVERAGEIF_BY',
    'BASE',
    'BIN2DEC',
    'BIN2HEX',
    'BIN2OCT',
    'BITAND',
    'BITLSHIFT',
    'BITOR',
    'BITRSHIFT',
    'BITXOR',
    'CEILING',
    'CEILING_MATH',
    'CHAR',
    'CHOOSE',
    'CLEAN',
    'CODE',
    'COL',
    'COLUMNS',
    'COMBIN',
    'COMBINA',
    'COMPLEX',
    'CONCAT',
    'CONCATENATE',
    'CONVERT',
    'CORREL',
    'COS',
    'COSH',
    'COT',
    'COTH',
    'COUNT',
    'COUNTA',
    'COUNTBLANK',
    'COUNTIF',
    'COUNTIFS_BY',
    'COUNTIF_BY',
    'COUPDAYS',
    'CSC',
    'CSCH',
    'CUMIPMT',
    'CUMPRINC',
    'DATE',
    'DATEDIF',
    'DATEVALUE',
    'DAY',
    'DAYS',
    'DAYS360',
    'DB',
    'DDB',
    'DEC2BIN',
    'DEC2HEX',
    'DEC2OCT',
    'DECIMAL',
    'DEGREES',
    'DELTA',
    'DEVSQ',
    'DISC',
    'DOLLAR',
    'DOLLARDE',
    'DOLLARFR',
    'EDATE',
    'EFFECT',
    'EOMONTH',
    'ERF',
    'ERFC',
    'EVEN',
    'EXACT',
    'EXP',
    'FACT',
    'FACTDOUBLE',
    'FALSE',
    'FIND',
    'FIXED',
    'FLOOR',
    'FLOOR_MATH',
    'FORECAST',
    'FV',
    'FVSCHEDULE',
    'GCD',
    'GEOMEAN',
    'GESTEP',
    'HARMEAN',
    'HEX2BIN',
    'HEX2DEC',
    'HEX2OCT',
    'HLOOKUP',
    'HOUR',
    'IF',
    'IFERROR',
    'IFNA',
    'IFS',
    'IMABS',
    'IMAGINARY',
    'IMARGUMENT',
    'IMCONJUGATE',
    'IMCOS',
    'IMCOSH',
    'IMCOT',
    'IMCSC',
    'IMCSCH',
    'IMDIV',
    'IMEXP',
    'IMLN',
    'IMLOG10',
    'IMLOG2',
    'IMPOWER',
    'IMPRODUCT',
    'IMREAL',
    'IMSEC',
    'IMSECH',
    'IMSIN',
    'IMSINH',
    'IMSQRT',
    'IMSUB',
    'IMSUM',
    'IMTAN',
    'INDEX',
    'INT',
    'INTERCEPT',
    'IPMT',
    'IRR',
    'IRR_BY',
    'ISBLANK',
    'ISERR',
    'ISERROR',
    'ISEVEN',
    'ISLOGICAL',
    'ISNA',
    'ISNONTEXT',
    'ISNUMBER',
    'ISODD',
    'ISOWEEKNUM',
    'ISPMT',
    'ISTEXT',
    'KURT',
    'LARGE',
    'LCM',
    'LEFT',
    'LEN',
    'LN',
    'LOG',
    'LOG10',
    'LOOKUP',
    'LOOKUP_BY',
    'LOWER',
    'MATCH',
    'MAX',
    'MAXIFS',
    'MEDIAN',
    'MID',
    'MIN',
    'MINIFS',
    'MINUTE',
    'MIRR',
    'MOD',
    'MONTH',
    'MROUND',
    'MULTINOMIAL',
    'N',
    'NETWORKDAYS',
    'NETWORKDAYS_INTL',
    'NOMINAL',
    'NOT',
    'NOW',
    'NPER',
    'NPV',
    'NPV_BY',
    'NUMBERVALUE',
    'OCT2BIN',
    'OCT2DEC',
    'OCT2HEX',
    'ODD',
    'OR',
    'PDURATION',
    'PEARSON',
    'PERCENTILE_EXC',
    'PERCENTILE_INC',
    'PERCENTRANK_EXC',
    'PERCENTRANK_INC',
    'PERMUT',
    'PI',
    'PMT',
    'POWER',
    'PPMT',
    'PRICEDISC',
    'PRODUCT',
    'PROPER',
    'PV',
    'QUARTILE_EXC',
    'QUARTILE_INC',
    'QUOTIENT',
    'RADIANS',
    'RAND',
    'RANDBETWEEN',
    'RANK_AVG',
    'RANK_EQ',
    'RATE',
    'REPLACE',
    'REPT',
    'RIGHT',
    'ROMAN',
    'ROUND',
    'ROUNDDOWN',
    'ROUNDUP',
    'ROWS',
    'RRI',
    'SEARCH',
    'SEC',
    'SECH',
    'SECOND',
    'SERIESSUM',
    'SIGN',
    'SIN',
    'SINH',
    'SKEW',
    'SLN',
    'SLOPE',
    'SMALL',
    'SQRT',
    'SQRTPI',
    'STDEV',
    'STDEV_P',
    'STDEV_S',
    'SUBSTITUTE',
    'SUM',
    'SUMIF',
    'SUMIFS_BY',
    'SUMIF_BY',
    'SUMPRODUCT',
    'SUMSQ',
    'SUMX2MY2',
    'SUMX2PY2',
    'SUMXMY2',
    'SWITCH',
    'SYD',
    'T',
    'TAN',
    'TANH',
    'TBILLEQ',
    'TBILLPRICE',
    'TBILLYIELD',
    'TEXT',
    'TEXTJOIN',
    'TIME',
    'TIMEVALUE',
    'TODAY',
    'TRIM',
    'TRIMMEAN',
    'TRUE',
    'TRUNC',
    'TYPE',
    'UNICHAR',
    'UNICODE',
    'UPPER',
    'VALUE',
    'VAR',
    'VAR_P',
    'VAR_S',
    'VLOOKUP',
    'VLOOKUP_BY',
    'WEEKDAY',
    'WEEKNUM',
    'WORKDAY',
    'WORKDAY_INTL',
    'LET',
    'XIRR',
    'XIRR_BY',
    'XNPV',
    'XNPV_BY',
    'XLOOKUP',
    'XOR',
    'YEAR',
    'YEARFRAC',
    ...Gr,
    ...Xr,
  ]);
var gl = new Set([
  'between',
  'implies',
  'like',
  'nonempty',
  'overlaps',
  'present',
  'when',
  'words',
]);
var bl = new Set(['CONTAINS', 'STARTSWITH', 'ENDSWITH']),
  xl = new Set(['^=', '$=', '*=']);
function Hr(e) {
  return `Readable string operator ${e} was removed. Use jq pipe form instead, such as Field | contains("text"), Field | startswith("prefix"), or Field | endswith("suffix").`;
}
function Wr(e) {
  let t = e.toLowerCase();
  return e !== t && bl.has(e.toUpperCase());
}
var wl = new Set([
    'AND',
    'AVERAGE',
    'CONCAT',
    'CONCATENATE',
    'COUNT',
    'COUNTA',
    'MAX',
    'MEDIAN',
    'MIN',
    'OR',
    'PRODUCT',
    'STDEV',
    'STDEV_P',
    'STDEV_S',
    'SUM',
    'SUMPRODUCT',
    'SUMSQ',
    'SWITCH',
    'VAR',
    'VAR_P',
    'VAR_S',
    'XOR',
  ]),
  Al = new Map([
    ['CHOOSE', 1],
    ['TEXTJOIN', 2],
  ]),
  Il = new Set([
    'add',
    'all',
    'any',
    'atan2',
    'contains',
    'endswith',
    'first',
    'flatten',
    'from_entries',
    'fromjson',
    'group_by',
    'has',
    'implies',
    'keys',
    'last',
    'length',
    'like',
    'log',
    'map',
    'map_values',
    'match',
    'max',
    'min',
    'nonempty',
    'now',
    'overlaps',
    'present',
    'reverse',
    'select',
    'sort',
    'sort_by',
    'split',
    'startswith',
    'to_entries',
    'tojson',
    'tonumber',
    'tostring',
    'trim',
    'type',
    'unique',
    'unique_by',
    'when',
    'with_entries',
    'words',
    'between',
  ]),
  ds = new Set([
    'abs',
    'acos',
    'acosh',
    'asin',
    'asinh',
    'atan',
    'atanh',
    'cos',
    'cosh',
    'erf',
    'erfc',
    'exp',
    'floor',
    'gamma',
    'log',
    'log10',
    'max',
    'min',
    'not',
    'now',
    'round',
    'sin',
    'sinh',
    'sqrt',
    'tan',
    'tanh',
    'trim',
    'trunc',
    'type',
  ]),
  vl = new Set(['all', 'item', 'last', 'position', 'row']),
  Rl = new Set(['first', 'last', 'only', 'odd', 'even']);
function fs(e) {
  return e.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function ms(e) {
  return e?.type === 'ident' ? e.value.toLowerCase() : void 0;
}
function K(e, t) {
  return ms(e) === t.toLowerCase();
}
function Sl({ name: e, explicitArity: t, separator: n, parenthesized: r }) {
  let i = e.toUpperCase();
  if (Wr(e)) throw new L(Hr(i));
  let o = e.toLowerCase();
  if (t !== void 0) {
    if (o === 'now' && r && t === 0) return { name: 'NOW', dialect: 'excel' };
    if (t === 0 && ds.has(o)) return { name: o, dialect: 'jq' };
    switch (o) {
      case 'match':
        if (t === 1) return { name: 'match', dialect: 'jq' };
        if (t === 2)
          return n === 'semicolon'
            ? { name: 'match', dialect: 'jq' }
            : { name: 'MATCH', dialect: 'excel' };
        if (t === 3) return { name: 'MATCH', dialect: 'excel' };
        break;
      case 'index':
        if (t === 1) return { name: 'index', dialect: 'jq' };
        if (t === 2 || t === 3) return { name: 'INDEX', dialect: 'excel' };
        break;
      case 'type':
        if (t === 1) return { name: 'TYPE', dialect: 'excel' };
        break;
      case 'log':
        if (t === 1 || t === 2) return { name: 'LOG', dialect: 'excel' };
        break;
      case 'trim':
        if (t === 1) return { name: 'TRIM', dialect: 'excel' };
        break;
      case 'atan2':
        if (t === 1) return { name: 'atan2', dialect: 'jq' };
        if (t === 2)
          return n === 'semicolon'
            ? { name: 'atan2', dialect: 'jq' }
            : { name: 'ATAN2', dialect: 'excel' };
        break;
    }
  }
  if (yl.has(i)) return { name: i, dialect: 'excel' };
  let s = ko(e, t);
  return s
    ? { name: s, dialect: 'bxl-helper' }
    : gl.has(o) || o === 'all' || o === 'any'
      ? { name: o, dialect: 'bxl-helper' }
      : Il.has(o)
        ? { name: o, dialect: 'jq' }
        : { name: e, dialect: 'unknown' };
}
function Tl(e) {
  return e.dialect === 'excel' || e.dialect === 'bxl-helper';
}
function Nl(e) {
  let t = e.toLowerCase();
  return ds.has(t) ? t : e;
}
function El(e, t) {
  let n = e.toUpperCase();
  if (wl.has(n) && t.length > 1)
    return `${e}([${t.map((i) => i.source).join(', ')}])`;
  let r = Al.get(n);
  if (r !== void 0 && t.length > r + 1) {
    let i = t.slice(0, r).map((s) => s.source),
      o = `[${t
        .slice(r)
        .map((s) => s.source)
        .join(', ')}]`;
    return `${e}(${[...i, o].join('; ')})`;
  }
  return `${e}(${t.map((i) => i.source).join('; ')})`;
}
function kl(e) {
  if (e.type === 'ident') {
    let t = e.value.toLowerCase();
    if (be.has(t) || _t.has(t)) return t;
    let n = Nl(e.value);
    if (n !== e.value) return n;
  }
  return qr(e);
}
function _l(e) {
  if (e.kind === 'array' || e.item) return e.item;
  if (e.fields) return { fields: e.fields };
}
function Cl(e) {
  if (e.kind === 'array' || e.item)
    return e.item ?? (e.fields ? { fields: e.fields } : void 0);
}
var ss = new WeakMap();
function as(e, t, n) {
  let r = e.get(t);
  (r || ((r = new Set()), e.set(t, r)), r.add(n));
}
function $l(e) {
  let t = ss.get(e);
  if (t) return t;
  t = { exact: new Map(), normalized: new Map(), resolutions: new Map() };
  for (let n of e.fields) {
    let r = [n.displayName, n.label, n.key].filter((i) => !!i);
    for (let i of r) (as(t.exact, i, n), as(t.normalized, fs(i), n));
  }
  return (ss.set(e, t), t);
}
function xe(e, t) {
  if (!e) return;
  let n = $l(e);
  if (n.resolutions.has(t)) return n.resolutions.get(t);
  let r = new Set();
  for (let s of n.exact.get(t) ?? []) r.add(s);
  for (let s of n.normalized.get(fs(t)) ?? []) r.add(s);
  if (r.size > 1)
    throw new L(`Ambiguous readable label '${t}' in schema scope`);
  let [i] = r;
  if (!i) {
    n.resolutions.set(t, void 0);
    return;
  }
  let o = { field: i, valueScope: _l(i), arrayItemScope: Cl(i) };
  return (n.resolutions.set(t, o), o);
}
function Ml(e) {
  return e.path?.length ? e.path : [e.key];
}
function Sn(e) {
  return Ml(e)
    .map((t) =>
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(t) ? `.${t}` : `[${JSON.stringify(t)}]`,
    )
    .join('');
}
function Tn(e) {
  if (
    e.type !== 'ident' ||
    !/^[A-Z][A-Za-z0-9]*$/.test(e.value) ||
    !/[a-z]/.test(e.value)
  )
    return null;
  let t = e.value.toLowerCase();
  return be.has(t) || _t.has(t)
    ? null
    : e.value[0].toLowerCase() + e.value.slice(1);
}
function Nn(e) {
  return /[A-Za-z_]/.test(e);
}
function En(e) {
  return /[A-Za-z0-9_]/.test(e);
}
function Ol(e, t) {
  for (let n = t - 1; n >= 0; n--) {
    let r = e[n];
    if (!/\s/.test(r)) return r;
  }
}
function Bl(e, t, n) {
  let r = [];
  for (let i = t - 1; i >= 0 && r.length < n; i--) {
    let o = e[i];
    /\s/.test(o) || r.unshift(o);
  }
  return r.join('');
}
function Dl(e, t) {
  let n = Ol(e, t),
    r = Bl(e, t, 2);
  if (n !== '[' && r !== '..') return !1;
  let i = e[t + 1] ?? '';
  if (/[0-9]/.test(i) || (i === '-' && /[0-9]/.test(e[t + 2] ?? ''))) return !0;
  if (!Nn(i)) return !1;
  let o = t + 1,
    s = '';
  for (; o < e.length && En(e[o]); ) s += e[o++];
  return Rl.has(s.toLowerCase());
}
function hs(e) {
  let t = [],
    n = 0;
  for (; n < e.length; ) {
    let r = e[n];
    if (/\s/.test(r)) {
      n++;
      continue;
    }
    if (r === '#' && !Dl(e, n) && !/[0-9]/.test(e[n + 1] ?? '')) {
      for (
        ;
        n < e.length &&
        e[n] !==
          `
`;
      )
        n++;
      continue;
    }
    if (r === '"') {
      let s = '',
        a = n;
      for (n++; n < e.length; ) {
        let l = e[n++];
        if (l === '\\') {
          let c = e[n++];
          if (c === void 0) throw new L('Unterminated string escape');
          s += `\\${c}`;
        } else {
          if (l === '"') break;
          s += l;
        }
      }
      let u;
      try {
        u = JSON.parse(`"${s}"`);
      } catch {
        u = s
          .replace(
            /\\n/g,
            `
`,
          )
          .replace(/\\t/g, '	')
          .replace(/\\r/g, '\r')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
      t.push({
        type: 'string',
        value: u,
        start: a,
        end: n,
        raw: e.slice(a, n),
      });
      continue;
    }
    if (/[0-9]/.test(r)) {
      let s = r,
        a = !1,
        u = n;
      for (n++; n < e.length; ) {
        let l = e[n];
        if (/[0-9]/.test(l)) {
          s += e[n++];
          continue;
        }
        if (l === '.' && !a && e[n + 1] !== '.') {
          ((a = !0), (s += e[n++]));
          continue;
        }
        break;
      }
      t.push({ type: 'number', value: s, start: u, end: n, raw: s });
      continue;
    }
    if (r === '$' && Nn(e[n + 1] ?? '')) {
      let s = '$',
        a = n;
      for (n++; n < e.length && En(e[n]); ) s += e[n++];
      t.push({ type: 'var', value: s, start: a, end: n, raw: s });
      continue;
    }
    if (r === '@' && Nn(e[n + 1] ?? '')) {
      let s = '@',
        a = n;
      for (n++; n < e.length && En(e[n]); ) s += e[n++];
      t.push({ type: 'format', value: s, start: a, end: n, raw: s });
      continue;
    }
    if (Nn(r)) {
      let s = r,
        a = n;
      for (n++; n < e.length && En(e[n]); ) s += e[n++];
      t.push({ type: 'ident', value: s, start: a, end: n, raw: s });
      continue;
    }
    let i = e.slice(n, n + 3),
      o = e.slice(n, n + 2);
    if (['?//', '//=', '...'].includes(i)) {
      (t.push({ type: 'op', value: i, start: n, end: n + 3, raw: i }),
        (n += 3));
      continue;
    }
    if (o === '<>') {
      (t.push({ type: 'op', value: '!=', start: n, end: n + 2, raw: '<>' }),
        (n += 2));
      continue;
    }
    if (
      [
        '==',
        '!=',
        '<=',
        '>=',
        '+=',
        '-=',
        '*=',
        '/=',
        '%=',
        '//',
        '|=',
        '?//',
        '..',
        '?.',
        '^=',
        '$=',
      ].includes(o)
    ) {
      (t.push({ type: 'op', value: o, start: n, end: n + 2, raw: o }),
        (n += 2));
      continue;
    }
    if ('()[]{}:;\\'.includes(r)) {
      (t.push({ type: 'punc', value: r, start: n, end: n + 1, raw: r }), n++);
      continue;
    }
    if ('.=!|+-*/%?<>,#^&'.includes(r)) {
      (t.push({ type: 'op', value: r, start: n, end: n + 1, raw: r }), n++);
      continue;
    }
    throw new L(`Cannot tokenize character '${r}' at position ${n}`);
  }
  return t;
}
function qr(e) {
  return e.type === 'string'
    ? e.raw && e.raw.includes('\\(')
      ? e.raw
      : JSON.stringify(e.value)
    : e.value;
}
function us(e) {
  return /^[A-Za-z_$@][A-Za-z0-9_$@]*$/.test(e);
}
function Ll(e) {
  return /[A-Za-z0-9_$@\])]$/.test(e);
}
function Pl(e) {
  return /^[A-Za-z_$@.0-9"]/.test(e);
}
function le(e, t) {
  if (!t) return;
  let n = e[e.length - 1];
  (n && be.has(n) && t && !/^[\s)\]},;]/.test(t) && e.push(' '),
    n &&
      (n.endsWith(';') || n.endsWith(',')) &&
      !t.startsWith(' ') &&
      e.push(' '),
    n &&
      (us(n) || be.has(n) || Ll(n)) &&
      (us(t) || be.has(t) || Pl(t)) &&
      e.push(' '),
    e.push(t));
}
function Fl(e) {
  let t = [];
  for (let n of e) le(t, n);
  return t.join('');
}
function Qe(e) {
  let t = [...e].filter((r) => r === '[').length,
    n = [...e].filter((r) => r === ']').length;
  return t > n;
}
function Ul(e) {
  switch (e) {
    case '(':
      return ')';
    case '[':
      return ']';
    case '{':
      return '}';
    default:
      throw new L(`Unexpected opener '${e}'`);
  }
}
function et(e, t) {
  let n = e[t];
  if (!n || n.type !== 'punc') throw new L('Expected opening punctuation');
  let r = Ul(n.value),
    i = 0;
  for (let o = t; o < e.length; o++) {
    let s = e[o];
    if (s.type === 'punc' && s.value === n.value) i++;
    else if (s.type === 'punc' && s.value === r && (i--, i === 0)) return o;
  }
  throw new L(`Unclosed '${n.value}'`);
}
function fe(e, t, n, r) {
  let i = [],
    o = 0,
    s = t;
  for (let a = t; a < n; a++) {
    let u = e[a];
    u.type === 'punc' && ['(', '[', '{'].includes(u.value)
      ? o++
      : u.type === 'punc' && [')', ']', '}'].includes(u.value)
        ? o--
        : o === 0 &&
          (((u.type === 'punc' || u.type === 'op') && u.value === r) ||
            (u.type === 'ident' &&
              u.value.toLowerCase() === r.toLowerCase())) &&
          (i.push([s, a]), (s = a + 1));
  }
  return (i.push([s, n]), i);
}
function ls(e, t, n, r) {
  return t === n ? [] : fe(e, t, n, r);
}
function zl(e, t) {
  return t.length > 1 ? 'semicolon' : e.length > 1 ? 'comma' : 'none';
}
function jl(e, t) {
  let n = e[t],
    r = e[t + 1];
  if (n?.type !== 'ident' || r?.type !== 'punc' || r.value !== '(') return;
  let i = t + 1,
    o;
  try {
    o = et(e, i);
  } catch {
    return;
  }
  let s = ls(e, i + 1, o, ','),
    a = ls(e, i + 1, o, ';'),
    u = zl(s, a),
    l = u === 'semicolon' ? a.length : s.length;
  return {
    open: i,
    close: o,
    separator: u,
    explicitArity: l,
    commaRanges: s,
    semicolonRanges: a,
    dispatch: Sl({
      name: n.value,
      explicitArity: l,
      separator: u,
      parenthesized: !0,
    }),
  };
}
function Ct(e, t = {}) {
  if (t.allowBareNumber && e.length === 1 && e[0].type === 'number') {
    let n = Number(e[0].value);
    if (!Number.isInteger(n) || n < 1)
      throw new L(`[${e[0].value}] must be a positive 1-based row number`);
    return { family: 'front', display: `#${e[0].value}`, oneBased: n };
  }
  if (e.length === 2 && e[0].value === '#' && e[1].type === 'number') {
    let n = Number(e[1].value);
    if (!Number.isInteger(n) || n < 1)
      throw new L(`[#${e[1].value}] must be a positive 1-based row number`);
    return { family: 'front', display: `#${e[1].value}`, oneBased: n };
  }
  if (e.length === 2 && e[0].value === '#' && e[1].type === 'ident') {
    let n = e[1].value.toLowerCase();
    return n === 'first'
      ? { family: 'front', display: '#first', oneBased: 1 }
      : n === 'last'
        ? { family: 'back', display: '#last', offsetFromLast: 0 }
        : void 0;
  }
  if (
    e.length === 4 &&
    e[0].value === '#' &&
    e[1].type === 'ident' &&
    e[1].value.toLowerCase() === 'last' &&
    e[2].type === 'op' &&
    e[2].value === '-' &&
    e[3].type === 'number'
  ) {
    let n = Number(e[3].value);
    if (!Number.isInteger(n) || n < 1)
      throw new L(
        `[#last-${e[3].value}] must subtract a positive whole number`,
      );
    return {
      family: 'back',
      display: `#last-${e[3].value}`,
      offsetFromLast: n,
    };
  }
}
function ys(e, t) {
  return e.family === 'front' && t.family === 'front'
    ? e.oneBased <= t.oneBased
    : e.family === 'front' && t.family === 'back'
      ? !0
      : e.family === 'back' && t.family === 'back'
        ? e.offsetFromLast >= t.offsetFromLast
        : !1;
}
function gs(e, t) {
  return e.family === 'front'
    ? `${e.oneBased - 1}`
    : e.offsetFromLast === 0
      ? `(${t} - 1)`
      : `(${t} - ${e.offsetFromLast + 1})`;
}
function bs(e, t) {
  return gs(e, t);
}
function xs(e, t) {
  return e.family === 'front'
    ? `${e.oneBased}`
    : e.offsetFromLast === 0
      ? `${t}`
      : `(${t} - ${e.offsetFromLast})`;
}
function Vl(e) {
  let t = fe(e, 0, e.length, '..');
  if (t.length === 1) {
    let n = Ct(e);
    return n
      ? { kind: 'single', display: n.display, indexExpr: gs(n, '$__len') }
      : void 0;
  }
  if (t.length === 2) {
    let n = Ct(e.slice(...t[0])),
      r = Ct(e.slice(...t[1]), { allowBareNumber: !0 });
    if (!n || !r) return;
    if (!ys(n, r))
      throw new L(
        `[${n.display}..${r.display}] range must move forward in collection order`,
      );
    return {
      kind: 'range',
      display: `${n.display}..${r.display}`,
      startExpr: bs(n, '$__len'),
      endExpr: xs(r, '$__len'),
    };
  }
}
function Xl(e) {
  return e
    .map((t) =>
      t.kind === 'single'
        ? `$__idx == ${t.indexExpr}`
        : `($__idx >= ${t.startExpr} and $__idx < ${t.endExpr})`,
    )
    .join(' or ');
}
function Kr(e) {
  return (
    e.length >= 2 &&
    ['row', 'item'].includes(ms(e[0]) ?? '') &&
    e[1].type === 'number'
  );
}
function cs(e) {
  if (!Kr(e)) return;
  let t = Number(e[1].value);
  if (!Number.isInteger(t) || t < 1)
    throw new L('Human row/item indices are 1-based');
  if (e.length === 2) return String(t - 1);
  if (e.length === 4 && e[2].type === 'op' && e[2].value === '..') {
    let n = Number(e[3].value);
    if (!Number.isInteger(n) || n < t)
      throw new L('Human row/item range must be increasing');
    return `${t - 1}:${n}`;
  }
}
function Gl(e) {
  return (
    e.length >= 3 && K(e[0], 'last') && e[1].value === '(' && e[2].value === ')'
  );
}
function ws(e) {
  return e.length === 0 ||
    (e[0].type === 'ident' &&
      vl.has(e[0].value.toLowerCase()) &&
      e[0].value.toLowerCase() !== 'not')
    ? !1
    : e.some(
        (t) =>
          t.type === 'ident' ||
          ['=', '==', '!=', '<', '<=', '>', '>='].includes(t.value) ||
          ['between', 'in', 'is', 'like'].includes(t.value.toLowerCase()),
      );
}
function ql(e) {
  return e.some(
    (t) => t.type === 'op' && (t.value === '.' || t.value === '?.'),
  );
}
function ce(e, t) {
  let n = t.rootScope ?? t.itemScope;
  return new kn(e, {
    schema: n,
    rootPathPrefix: t.rootScope ? t.rootPathPrefix : void 0,
    itemScope: t.itemScope,
    bindings: t.bindings,
  }).compile(n);
}
function ke(e, t) {
  let n = fe(e, 0, e.length, 'or');
  if (n.length > 1) {
    let p = n.map(([g, x]) => ke(e.slice(g, x), t));
    return {
      source: p.map((g) => `(${g.source})`).join(' or '),
      changed: p.some((g) => g.changed),
      warnings: p.flatMap((g) => g.warnings),
      needsRootBinding: p.some((g) => g.needsRootBinding),
    };
  }
  let r = Yl(e, t);
  if (r) return r;
  let i = fe(e, 0, e.length, 'and');
  if (i.length > 1) {
    let p = i.map(([g, x]) => ke(e.slice(g, x), t));
    return {
      source: p.map((g) => `(${g.source})`).join(' and '),
      changed: p.some((g) => g.changed),
      warnings: p.flatMap((g) => g.warnings),
      needsRootBinding: p.some((g) => g.needsRootBinding),
    };
  }
  if (K(e[0], 'not')) {
    let p = ke(e.slice(1), t);
    return {
      source: `(${p.source}) | not`,
      changed: !0,
      warnings: p.warnings,
      needsRootBinding: p.needsRootBinding,
    };
  }
  if (e[0]?.value === '(' && e[e.length - 1]?.value === ')') {
    let p = ke(e.slice(1, -1), t);
    return {
      source: `(${p.source})`,
      changed: p.changed,
      warnings: p.warnings,
      needsRootBinding: p.needsRootBinding,
    };
  }
  let o = e.find((p) => xl.has(p.value) || (p.type === 'ident' && Wr(p.value)));
  if (o) throw new L(Hr(o.value));
  let s = e.findIndex(
    (p) =>
      ['=', '==', '!=', '<', '<=', '>', '>='].includes(p.value) ||
      p.value.toUpperCase() === 'IN',
  );
  if (s === -1) {
    let p = ce(e, t);
    return {
      source: p.source,
      changed: !0,
      warnings: p.warnings,
      needsRootBinding: p.needsRootBinding,
    };
  }
  let a = ce(e.slice(0, s), t),
    u =
      e[s].value.toUpperCase() === 'IN' ? e[s].value.toUpperCase() : e[s].value,
    l = ce(e.slice(s + 1), t),
    c = [...a.warnings, ...l.warnings],
    d = !!(a.needsRootBinding || l.needsRootBinding);
  switch (u) {
    case '=':
      return {
        source: `${a.source} == ${l.source}`,
        changed: !0,
        warnings: c,
        needsRootBinding: d,
      };
    case '==':
    case '!=':
    case '<':
    case '<=':
    case '>':
    case '>=':
      return {
        source: `${a.source} ${u} ${l.source}`,
        changed: a.changed || l.changed,
        warnings: c,
        needsRootBinding: d,
      };
    case 'IN':
      return {
        source: `(${a.source} | IN(${l.source}))`,
        changed: !0,
        warnings: [
          ...c,
          {
            code: 'in-predicate-needs-helper',
            message:
              'Readable IN predicates compile to IN(value); add a native helper before using this in production.',
          },
        ],
        needsRootBinding: d,
      };
    default:
      throw new L(`Unsupported predicate operator '${u}'`);
  }
}
function Yl(e, t) {
  let n = tt(e, 'is');
  if (n > 0) {
    let s = K(e[n + 1], 'not') ? n + 1 : -1,
      a = s === -1 ? n + 1 : n + 2,
      u = As(e[a]);
    if (u && a === e.length - 1) {
      let l = ce(e.slice(0, n), t),
        c = s === -1 ? '==' : '!=';
      return {
        source: `${l.source} ${c} ${u}`,
        changed: !0,
        warnings: l.warnings,
        needsRootBinding: l.needsRootBinding,
      };
    }
  }
  let r = tt(e, 'between');
  if (r > 0) {
    let s = K(e[r - 1], 'not') ? r - 1 : -1,
      a = s === -1 ? r : s,
      u = tt(e, 'and', r + 1);
    if (u > r + 1 && u < e.length - 1) {
      let l = ce(e.slice(0, a), t),
        c = ce(e.slice(r + 1, u), t),
        d = ce(e.slice(u + 1), t),
        p = `between(${l.source}; ${c.source}; ${d.source})`;
      return {
        source: s === -1 ? p : `(${p} | not)`,
        changed: !0,
        warnings: [...l.warnings, ...c.warnings, ...d.warnings],
        needsRootBinding: !!(
          l.needsRootBinding ||
          c.needsRootBinding ||
          d.needsRootBinding
        ),
      };
    }
  }
  let i = tt(e, 'like');
  if (i > 0) {
    let s = K(e[i - 1], 'not') ? i - 1 : -1,
      a = s === -1 ? i : s,
      u = ce(e.slice(0, a), t),
      l = ce(e.slice(i + 1), t),
      c = `like(${u.source}; ${l.source})`;
    return {
      source: s === -1 ? c : `(${c} | not)`,
      changed: !0,
      warnings: [...u.warnings, ...l.warnings],
      needsRootBinding: !!(u.needsRootBinding || l.needsRootBinding),
    };
  }
  let o = tt(e, 'in');
  if (o > 0 && K(e[o - 1], 'not')) {
    let s = ce(e.slice(0, o - 1), t),
      a = ce(e.slice(o + 1), t);
    return {
      source: `((${s.source} | IN(${a.source})) | not)`,
      changed: !0,
      warnings: [
        ...s.warnings,
        ...a.warnings,
        {
          code: 'in-predicate-needs-helper',
          message:
            'Readable IN predicates compile to IN(value); add a native helper before using this in production.',
        },
      ],
      needsRootBinding: !!(s.needsRootBinding || a.needsRootBinding),
    };
  }
}
function tt(e, t, n = 0) {
  let r = 0;
  for (let i = n; i < e.length; i++) {
    let o = e[i];
    if (o.type === 'punc') {
      o.value === '(' || o.value === '[' || o.value === '{'
        ? r++
        : (o.value === ')' || o.value === ']' || o.value === '}') && r--;
      continue;
    }
    if (r === 0 && K(o, t)) return i;
  }
  return -1;
}
function As(e) {
  if (!e || e.type !== 'ident') return;
  let t = e.value.toLowerCase();
  if (t === 'null' || t === 'true' || t === 'false') return t;
}
var kn = class e {
  constructor(t, n, r = 0, i = t.length) {
    this.tokens = t;
    ((this.index = r),
      (this.end = i),
      (this.schema = n.schema),
      (this.rootPathPrefix = n.rootPathPrefix),
      (this.constructorItemScope = n.itemScope),
      (this.bindings = new Set(n.bindings ?? [])));
  }
  index = 0;
  end;
  schema;
  rootPathPrefix;
  constructorItemScope;
  bindings;
  compile(t = this.schema) {
    let n = [],
      r = [],
      i = !1,
      o,
      s = !1,
      a = this.rootPathPrefix,
      u = this.constructorItemScope ?? t;
    for (; this.index < this.end; ) {
      let l = this.tokens[this.index];
      if (l.type === 'op' && l.value === '|') {
        (le(n, '|'),
          this.index++,
          this.schema && (a = '$root'),
          o && ((u = o), (o = void 0)));
        continue;
      }
      if (K(l, 'not')) {
        let d = this.tokens[this.index + 1];
        if (d?.type === 'punc' && d.value === '(') {
          let p = this.index + 1,
            g = et(this.tokens, p),
            x = new e(
              this.tokens,
              {
                schema: this.schema,
                rootPathPrefix: a,
                itemScope: u,
                bindings: this.bindings,
              },
              p + 1,
              g,
            ).compile(t);
          (le(n, `((${x.source}) | not)`),
            r.push(...x.warnings),
            (s = s || !!x.needsRootBinding),
            (i = !0),
            (this.index = g + 1));
          continue;
        }
        if (
          d?.type === 'ident' &&
          this.tokens[this.index + 2]?.type === 'punc' &&
          this.tokens[this.index + 2]?.value === '('
        ) {
          this.index++;
          let p = this.compileFunctionCall(t, a, u);
          (le(n, `((${p.source}) | not)`),
            r.push(...p.warnings),
            (s = s || !!p.needsRootBinding),
            (o = p.streamItemScope ?? o),
            (i = !0));
          continue;
        }
        if (d?.type === 'ident' || d?.value === '.') {
          this.index++;
          let p = this.tryCompilePath(t, a, u);
          if (p) {
            (le(n, `((${p.source}) | not)`),
              r.push(...p.warnings),
              (s = s || !!p.needsRootBinding),
              (o = p.streamItemScope ?? o),
              (i = !0));
            continue;
          }
          this.index--;
        }
      }
      if (
        l.type === 'ident' &&
        this.tokens[this.index + 1]?.type === 'punc' &&
        this.tokens[this.index + 1]?.value === '(' &&
        !be.has(l.value) &&
        !(['and', 'or'].includes(l.value.toLowerCase()) && n.length > 0) &&
        !xe(t, l.value) &&
        !xe(u, l.value)
      ) {
        let d = this.compileFunctionCall(t, a, u);
        (le(n, d.source),
          r.push(...d.warnings),
          (i = i || d.changed),
          (s = s || !!d.needsRootBinding),
          (o = d.streamItemScope ?? o));
        continue;
      }
      let c = this.tryCompilePath(t, a, u);
      if (c) {
        (le(n, c.source),
          r.push(...c.warnings),
          (i = i || c.changed),
          (s = s || !!c.needsRootBinding),
          (o = c.streamItemScope ?? o));
        continue;
      }
      if (l.type === 'punc' && l.value === '(') {
        let d = et(this.tokens, this.index),
          p = new e(
            this.tokens,
            {
              schema: this.schema,
              rootPathPrefix: a,
              itemScope: u,
              bindings: this.bindings,
            },
            this.index + 1,
            d,
          ).compile(t);
        (le(n, `(${p.source})`),
          r.push(...p.warnings),
          (i = i || p.changed),
          (s = s || !!p.needsRootBinding),
          (this.index = d + 1));
        continue;
      }
      if (l.type === 'punc' && l.value === '[') {
        let d = et(this.tokens, this.index),
          p = new e(
            this.tokens,
            {
              schema: this.schema,
              rootPathPrefix: a,
              itemScope: u,
              bindings: this.bindings,
            },
            this.index + 1,
            d,
          ).compile(t);
        (le(n, `[${p.source}]`),
          r.push(...p.warnings),
          (i = i || p.changed),
          (s = s || !!p.needsRootBinding),
          (this.index = d + 1));
        continue;
      }
      if (l.type === 'punc' && l.value === '{') {
        let d = this.compileObject(t, a, u);
        (le(n, d.source),
          r.push(...d.warnings),
          (i = i || d.changed),
          (s = s || !!d.needsRootBinding));
        continue;
      }
      (le(n, kl(l)), this.index++);
    }
    return {
      source: Fl(n),
      changed: i,
      warnings: r,
      streamItemScope: o,
      needsRootBinding: s,
    };
  }
  compileObject(t, n, r) {
    let i = et(this.tokens, this.index),
      o = fe(this.tokens, this.index + 1, i, ','),
      s = [],
      a = [],
      u = !1,
      l = !1;
    for (let [c, d] of o) {
      if (c === d) continue;
      let p = this.findTopLevelToken(c, d, ':');
      if (p === -1) {
        s.push(this.tokens.slice(c, d).map(qr).join(''));
        continue;
      }
      let g = this.tokens.slice(c, p).map(qr).join(''),
        x = new e(
          this.tokens,
          {
            schema: this.schema,
            rootPathPrefix: n,
            itemScope: r,
            bindings: this.bindings,
          },
          p + 1,
          d,
        ).compile(t);
      (s.push(`${g}:${x.source}`),
        a.push(...x.warnings),
        (u = u || x.changed),
        (l = l || !!x.needsRootBinding));
    }
    return (
      (this.index = i + 1),
      {
        source: `{${s.join(', ')}}`,
        changed: u,
        warnings: a,
        needsRootBinding: l,
      }
    );
  }
  findTopLevelToken(t, n, r) {
    let i = 0;
    for (let o = t; o < n; o++) {
      let s = this.tokens[o];
      if (s.type === 'punc' && ['(', '[', '{'].includes(s.value)) i++;
      else if (s.type === 'punc' && [')', ']', '}'].includes(s.value)) i--;
      else if (i === 0 && s.value === r) return o;
    }
    return -1;
  }
  compileFunctionCall(t, n, r) {
    let i = this.tokens[this.index].value,
      o = jl(this.tokens, this.index);
    if (!o) throw new L('Expected function call');
    let s = o.dispatch.name,
      a = o.close,
      u = o.separator !== 'semicolon' && Tl(o.dispatch),
      l = u ? o.commaRanges : o.semicolonRanges;
    if (s === 'LET') {
      let p = this.compileLetFunction(l, t, n, r);
      return ((this.index = a + 1), p);
    }
    let c = l.map(([p, g]) =>
      new e(
        this.tokens,
        {
          schema: this.schema,
          rootPathPrefix: n,
          itemScope: r,
          bindings: this.bindings,
        },
        p,
        g,
      ).compile(t),
    );
    if (['all', 'any'].includes(s) && c.length === 2 && c[0].streamItemScope) {
      let p = l[1];
      c[1] = ke(this.tokens.slice(p[0], p[1]), {
        itemScope: c[0].streamItemScope,
        rootScope: this.schema,
        rootPathPrefix: n ?? '$root',
        bindings: this.bindings,
      });
    }
    this.index = a + 1;
    let d = El(s, c);
    return {
      source: d,
      changed:
        i !== s ||
        u ||
        d !== `${s}(${c.map((p) => p.source).join('; ')})` ||
        c.some((p) => p.changed),
      warnings: c.flatMap((p) => p.warnings),
      streamItemScope: c[0]?.streamItemScope,
      needsRootBinding: c.some((p) => p.needsRootBinding),
    };
  }
  compileLetFunction(t, n, r, i) {
    if (t.length < 3 || t.length % 2 === 0)
      throw new L(
        'LET expects one or more name/value pairs followed by a final expression.',
      );
    let o = [],
      s = new Set(this.bindings),
      a = [],
      u = !1;
    for (let p = 0; p < t.length - 1; p += 2) {
      let g = this.letBindingName(t[p]),
        x = t[p + 1],
        w = new e(
          this.tokens,
          { schema: this.schema, rootPathPrefix: r, itemScope: i, bindings: s },
          x[0],
          x[1],
        ).compile(n);
      (a.push({ name: g, value: w }),
        o.push(...w.warnings),
        (u = u || !!w.needsRootBinding),
        s.add(g));
    }
    let l = t[t.length - 1],
      c = new e(
        this.tokens,
        { schema: this.schema, rootPathPrefix: r, itemScope: i, bindings: s },
        l[0],
        l[1],
      ).compile(n);
    (o.push(...c.warnings), (u = u || !!c.needsRootBinding));
    let d = c.source;
    for (let p of [...a].reverse())
      d = `(${p.value.source}) as $${p.name} | ${d}`;
    return {
      source: d,
      changed: !0,
      warnings: o,
      streamItemScope: c.streamItemScope,
      needsRootBinding: u,
    };
  }
  letBindingName(t) {
    let n = this.tokens.slice(t[0], t[1]);
    if (
      n.length !== 1 ||
      n[0].type !== 'ident' ||
      be.has(n[0].value.toLowerCase()) ||
      _t.has(n[0].value.toLowerCase())
    )
      throw new L('LET binding names must be bare identifiers.');
    return n[0].value;
  }
  tryCompilePath(t, n, r) {
    let i = this.index,
      o = this.tokens[this.index],
      s = '',
      a = !1,
      u = [],
      l,
      c,
      d,
      p = !1,
      g = !1,
      x = !1,
      w = r ?? t,
      S = !t;
    if (o?.type === 'op' && o.value === '.') {
      ((s = '.'), this.index++);
      let m = this.readLabelToken(w);
      if (m) {
        let T = xe(w, m.value),
          $ = !T && S ? Tn(m) : null;
        ((s = T ? Sn(T.field) : `.${$ ?? m.value}`),
          (l = T?.valueScope),
          (c = T?.arrayItemScope),
          (x = T?.field.kind === 'array'),
          (a = a || !!(T && T.field.key !== m.value) || !!$));
      }
    } else if (o?.type === 'op' && o.value === '?.') {
      ((s = '.'), this.index++);
      let m = this.readLabelToken(w);
      if (!m) return ((this.index = i), null);
      let T = xe(w, m.value),
        $ = !T && S ? Tn(m) : null;
      ((s = `${T ? Sn(T.field) : `.${$ ?? m.value}`}?`),
        (l = T?.valueScope),
        (c = T?.arrayItemScope),
        (x = T?.field.kind === 'array'),
        (a = !0));
    } else if (o?.type === 'ident' && this.bindings.has(o.value))
      ((s = `$${o.value}`), this.index++, (a = !0));
    else {
      let m = r && r !== t ? r : void 0,
        T = this.readLabelToken(m ?? t, t);
      if (!T || this.tokens[this.index]?.value === '(')
        return ((this.index = i), null);
      let $ = xe(m, T.value),
        F = xe(t, T.value),
        U = $ ?? F,
        Z = !U && S ? Tn(T) : null;
      if (!U && !Z) return ((this.index = i), null);
      let nt = U ? Sn(U.field) : `.${Z}`;
      ((s = $ ? nt : n ? `${n}${nt}` : nt),
        (l = U?.valueScope),
        (c = U?.arrayItemScope),
        (x = U?.field.kind === 'array'),
        (a = !0));
    }
    for (; this.index < this.end; ) {
      let m = this.tokens[this.index];
      if (m.type === 'op' && m.value === '?') {
        ((s += '?'), (a = !0), this.index++);
        continue;
      }
      if (m.type === 'op' && (m.value === '.' || m.value === '?.')) {
        let T = m.value === '?.';
        (x && !p && ((s = `[${s}[]`), (p = !0), (a = !0), (x = !1)),
          this.index++);
        let $ = this.readLabelToken(l);
        if (!$) return ((this.index = i), null);
        let F = xe(l, $.value),
          U = !F && S ? Tn($) : null;
        if (!F && !U && l)
          throw new L(`Unknown field '${$.value}' in schema-aware path.`);
        let Z = F ? Sn(F.field) : `.${U ?? $.value}`;
        ((s += `${T ? '?' : ''}${Z}`),
          (l = F?.valueScope),
          (c = F?.arrayItemScope),
          (x = F?.field.kind === 'array'),
          (a = a || T || !!(F && F.field.key !== $.value)));
        continue;
      }
      if (m.type === 'punc' && m.value === '[') {
        let T = this.compileIndexSuffix(s, l, c, p, n);
        ((s = T.source),
          (a = a || T.changed),
          u.push(...T.warnings),
          (g = g || !!T.needsRootBinding),
          (l = T.valueScope),
          (c = T.arrayItemScope),
          (d = T.streamItemScope ?? d),
          (p = T.openMaterialized ?? p),
          (x = !1));
        continue;
      }
      if (m.type === 'punc' && m.value === ':')
        throw new L(
          'CSS-style pseudo-class syntax was removed; use [#first], [#last], [#last-N], [#only], [#odd], [#even], [#N], or [#-N].',
        );
      break;
    }
    return (
      p && Qe(s) && (s += ']'),
      {
        source: s,
        changed: a,
        warnings: u,
        next: this.index,
        valueScope: l,
        arrayItemScope: c,
        streamItemScope: d,
        needsRootBinding: g || !!(n && s.includes(n)),
      }
    );
  }
  readLabelToken(t, n) {
    let r = this.tokens[this.index];
    if (!(!r || !['ident', 'string'].includes(r.type))) {
      if (r.type === 'ident') {
        let i,
          o = [];
        for (let s = this.index; s < this.end; s++) {
          let a = this.tokens[s];
          if (a.type !== 'ident') break;
          let u = a.value.toLowerCase();
          if (s > this.index && (be.has(u) || _t.has(u))) break;
          o.push(a.value);
          let l = o.join(' ');
          ((t && xe(t, l)) || (n && xe(n, l))) &&
            (i = { value: l, next: s + 1 });
        }
        if (i)
          return ((this.index = i.next), { type: 'ident', value: i.value });
      }
      return (this.index++, r);
    }
  }
  compileIndexSuffix(t, n, r, i, o) {
    let s = this.index,
      a = et(this.tokens, s),
      u = this.tokens.slice(s + 1, a);
    this.index = a + 1;
    let l = r ?? n;
    if (u.length === 0)
      return {
        source: `${t}[]`,
        changed: !1,
        warnings: [],
        next: this.index,
        valueScope: l,
        streamItemScope: l,
      };
    if (u.length === 1 && (K(u[0], 'all') || u[0].value === '...'))
      return {
        source: `[${t}[]`,
        changed: !0,
        warnings: [],
        next: this.index,
        valueScope: l,
        streamItemScope: l,
        openMaterialized: !0,
      };
    if (u[0]?.type === 'op' && u[0].value === '*' && l) {
      let w = u.slice(1);
      if (w.length === 0)
        return {
          source: `[${t}[]`,
          changed: !0,
          warnings: [],
          next: this.index,
          valueScope: l,
          arrayItemScope: l,
          streamItemScope: l,
          openMaterialized: !0,
        };
      if (!ql(w))
        throw new L(
          'Filter-all [* ...] predicates must use explicit current-item paths such as [* .Field] or [* ."Display Label"].',
        );
      let S = ke(w, {
        itemScope: l,
        rootScope: this.schema,
        rootPathPrefix: o ?? '$root',
        bindings: this.bindings,
      });
      return {
        source: `[${t}[] | select(${S.source})`,
        changed: !0,
        warnings: S.warnings,
        next: this.index,
        valueScope: l,
        arrayItemScope: l,
        streamItemScope: l,
        openMaterialized: !0,
        needsRootBinding: S.needsRootBinding,
      };
    }
    let c = fe(u, 0, u.length, ',');
    if (c.length > 1) {
      let w = c.map(([S, m]) => Vl(u.slice(S, m)));
      if (w.every((S) => !!S))
        return {
          source: `[(${Qe(t) ? `${t}]` : t}) as $__seq | ($__seq | length) as $__len | range(0; $__len) as $__idx | select(${Xl(w)}) | $__seq[$__idx]`,
          changed: !0,
          warnings: [],
          next: this.index,
          valueScope: l,
          arrayItemScope: l,
          streamItemScope: l,
          openMaterialized: !0,
        };
    }
    if (
      u.length === 4 &&
      u[0].value === '#' &&
      u[1].type === 'ident' &&
      u[1].value.toLowerCase() === 'last' &&
      u[2].type === 'op' &&
      u[2].value === '-' &&
      u[3].type === 'number'
    ) {
      let w = Number(u[3].value);
      if (!Number.isInteger(w) || w < 1)
        throw new L(
          `[#last-${u[3].value}] must subtract a positive whole number`,
        );
      return {
        source: `${t}[-${w + 1}]`,
        changed: !0,
        warnings: [],
        next: this.index,
        valueScope: l,
      };
    }
    if (u.length === 2 && u[0].value === '#' && u[1].type === 'ident') {
      let w = u[1].value.toLowerCase(),
        S = Qe(t) ? `${t}]` : t;
      if (w === 'first')
        return {
          source: `${t}[0]`,
          changed: !0,
          warnings: [],
          next: this.index,
          valueScope: l,
        };
      if (w === 'last')
        return {
          source: `${t}[-1]`,
          changed: !0,
          warnings: [],
          next: this.index,
          valueScope: l,
        };
      if (w === 'only')
        return {
          source: `((${S}) as $__seq | ($__seq | length) as $__len | if $__len == 1 then $__seq[0] else error("expected exactly 1 element, got \\($__len)") end)`,
          changed: !0,
          warnings: [],
          next: this.index,
          valueScope: l,
        };
      if (w === 'odd' || w === 'even')
        return {
          source: `[${S} | .[range(${w === 'odd' ? 0 : 1}; length; 2)]`,
          changed: !0,
          warnings: [],
          next: this.index,
          valueScope: l,
          arrayItemScope: l,
          streamItemScope: l,
          openMaterialized: !0,
        };
      throw new L(`Unsupported positional selector keyword '#${u[1].value}'`);
    }
    if (
      u.length === 3 &&
      u[0].value === '#' &&
      u[1].type === 'op' &&
      u[1].value === '-' &&
      u[2].type === 'number'
    ) {
      let w = Number(u[2].value);
      if (!Number.isInteger(w) || w < 1)
        throw new L(
          `[#-${u[2].value}] must be a negative index with a positive magnitude`,
        );
      return {
        source: `${t}[-${w}]`,
        changed: !0,
        warnings: [],
        next: this.index,
        valueScope: l,
      };
    }
    if (u.length === 2 && u[0].value === '#' && u[1].type === 'number') {
      let w = Number(u[1].value);
      if (!Number.isInteger(w) || w < 1)
        throw new L(`[#${u[1].value}] must be a positive 1-based row number`);
      return {
        source: `${t}[${w - 1}]`,
        changed: !0,
        warnings: [],
        next: this.index,
        valueScope: l,
      };
    }
    let d = fe(u, 0, u.length, '..');
    if (d.length === 2) {
      let w = Ct(u.slice(...d[0])),
        S = Ct(u.slice(...d[1]), { allowBareNumber: !0 });
      if (w && S) {
        if (!ys(w, S))
          throw new L(
            `[${w.display}..${S.display}] range must move forward in collection order`,
          );
        let m = Qe(t) ? `${t}]` : t,
          T = '$__seq',
          $ = `(${T} | length)`;
        return {
          source: `[(${m}) as ${T} | ${T}[${bs(w, $)}:${xs(S, $)}][]`,
          changed: !0,
          warnings: [],
          next: this.index,
          valueScope: l,
          arrayItemScope: l,
          streamItemScope: l,
          openMaterialized: !0,
        };
      }
    }
    let p = fe(u, 0, u.length, ',');
    if (p.length === 2 && Kr(u.slice(...p[0]))) {
      let w = cs(u.slice(...p[0])),
        S = ke(u.slice(...p[1]), {
          itemScope: l,
          rootScope: this.schema,
          rootPathPrefix: o ?? '$root',
          bindings: this.bindings,
        });
      return {
        source: `(${t}[${w}] | select(${S.source}))`,
        changed: !0,
        warnings: S.warnings,
        next: this.index,
        valueScope: l,
        needsRootBinding: S.needsRootBinding,
      };
    }
    let g = cs(u);
    if (g !== void 0)
      return g.includes(':')
        ? {
            source: `[(${Qe(t) ? `${t}]` : t}) as $__seq | $__seq[${g}][]`,
            changed: !0,
            warnings: [],
            next: this.index,
            valueScope: l,
            arrayItemScope: l,
            streamItemScope: l,
            openMaterialized: !0,
          }
        : {
            source: `${t}[${g}]`,
            changed: !0,
            warnings: [],
            next: this.index,
            valueScope: l,
            arrayItemScope: r,
          };
    if (Gl(u)) {
      let w = '-1';
      return (
        u.length === 5 &&
          u[3].value === '-' &&
          u[4].type === 'number' &&
          (w = `-${Number(u[4].value) + 1}`),
        {
          source: `${t}[${w}]`,
          changed: !0,
          warnings: [],
          next: this.index,
          valueScope: l,
        }
      );
    }
    if (ws(u) && l) {
      let w = ke(u, {
        itemScope: l,
        rootScope: this.schema,
        rootPathPrefix: o ?? '$root',
        bindings: this.bindings,
      });
      return {
        source: `first(${t}[] | select(${w.source}))`,
        changed: !0,
        warnings: w.warnings,
        next: this.index,
        valueScope: l,
        needsRootBinding: w.needsRootBinding,
      };
    }
    if (fe(u, 0, u.length, ':').length === 2) {
      let w = new e(u, {
        schema: this.schema,
        rootPathPrefix: o,
        bindings: this.bindings,
      }).compile(n);
      return {
        source: `[(${Qe(t) ? `${t}]` : t}) as $__seq | $__seq[${w.source}][]`,
        changed: w.changed,
        warnings: w.warnings,
        next: this.index,
        valueScope: l,
        arrayItemScope: l,
        streamItemScope: l,
        openMaterialized: !0,
        needsRootBinding: w.needsRootBinding,
      };
    }
    let x = new e(u, {
      schema: this.schema,
      rootPathPrefix: o,
      bindings: this.bindings,
    }).compile(n);
    return {
      source: `${t}[${x.source}]`,
      changed: x.changed,
      warnings: x.warnings,
      next: this.index,
      valueScope: l,
      arrayItemScope: i ? r : void 0,
      needsRootBinding: x.needsRootBinding,
    };
  }
};
function Hl(e) {
  let t = e.match(/^(\s*)=(?!=)/);
  return t
    ? { source: t[1] + e.slice(t[0].length), changed: !0 }
    : { source: e, changed: !1 };
}
function Wl(e) {
  let t = e,
    n = 0;
  for (; n++ < 1024; ) {
    let r = _n(t);
    if (!r) break;
    let i = !1,
      o = Is(r);
    for (let s = r.length - 1; s >= 0; s--) {
      let a = r[s];
      if (a.type !== 'ident' || o[s] > 0) continue;
      let u = r[s + 1],
        l = u && u.type === 'punc' && u.value === '(' && u.start === a.end;
      if (Wr(a.value)) {
        if (l || (ie(r, s, -1) && ie(r, s, 1))) throw new L(Hr(a.value));
        continue;
      }
      if (K(a, 'is')) {
        let m = ie(r, s, -1),
          T = K(r[s + 1], 'not') ? s + 1 : -1,
          $ = T === -1 ? s + 1 : s + 2,
          F = As(r[$]),
          U = r[$];
        if (m && F && U?.end !== void 0) {
          let Z = t.slice(m.start, m.end);
          ((t =
            t.slice(0, m.start) +
            `${Z} ${T === -1 ? '==' : '!='} ${F}` +
            t.slice(U.end)),
            (i = !0));
          break;
        }
      }
      if (K(a, 'between')) {
        let m = K(r[s - 1], 'not') ? s - 1 : -1,
          T = ie(r, m === -1 ? s : m, -1),
          $ = ie(r, s, 1),
          F = tt(r, 'and', s + 1),
          U = F === -1 ? void 0 : ie(r, F, 1);
        if (T && $ && U && F > s) {
          let Z = t.slice(T.start, T.end),
            nt = t.slice($.start, $.end),
            ni = t.slice(U.start, U.end),
            ri = `between(${Z}; ${nt}; ${ni})`;
          ((t =
            t.slice(0, T.start) +
            (m === -1 ? ri : `(${ri} | not)`) +
            t.slice(U.end)),
            (i = !0));
          break;
        }
      }
      if (K(a, 'like')) {
        let m = K(r[s - 1], 'not') ? s - 1 : -1,
          T = ie(r, m === -1 ? s : m, -1),
          $ = ie(r, s, 1);
        if (T && $) {
          let F = t.slice(T.start, T.end),
            U = t.slice($.start, $.end),
            Z = `like(${F}; ${U})`;
          ((t =
            t.slice(0, T.start) +
            (m === -1 ? Z : `(${Z} | not)`) +
            t.slice($.end)),
            (i = !0));
          break;
        }
      }
      let c = a.value.toUpperCase() === 'IN' ? 'IN' : void 0;
      if (!c || l) continue;
      let d = c === 'IN' && K(r[s - 1], 'not') ? s - 1 : -1,
        p = ie(r, d === -1 ? s : d, -1),
        g = ie(r, s, 1);
      if (!p || !g) continue;
      let x = t.slice(p.start, p.end),
        w = t.slice(g.start, g.end),
        S =
          c === 'IN'
            ? d === -1
              ? `(${x} | IN(${w}))`
              : `((${x} | IN(${w})) | not)`
            : void 0;
      if (S) {
        ((t = t.slice(0, p.start) + S + t.slice(g.end)), (i = !0));
        break;
      }
    }
    if (!i) break;
  }
  return { source: t, changed: t !== e };
}
function Kl(e) {
  let t = e,
    n = !1,
    r = 0;
  for (; r++ < 1024; ) {
    let i = _n(t);
    if (!i) break;
    let o = !1;
    for (let s = i.length - 1; s >= 0; s--) {
      let a = i[s];
      if (a.type !== 'op' || (a.value !== '^' && a.value !== '&')) continue;
      let u = ie(i, s, -1),
        l = ie(i, s, 1);
      if (!u || !l) continue;
      let c = t.slice(u.start, u.end),
        d = t.slice(l.start, l.end),
        p =
          a.value === '^'
            ? `POWER(${c}, ${d})`
            : `((${c}|tostring) + (${d}|tostring))`;
      ((t = t.slice(0, u.start) + p + t.slice(l.end)), (n = !0), (o = !0));
      break;
    }
    if (!o) break;
  }
  return { source: t, changed: n };
}
function _n(e) {
  try {
    return hs(e);
  } catch {
    return;
  }
}
function ie(e, t, n) {
  let r = t + n,
    i = e[r];
  if (!i || i.start === void 0 || i.end === void 0) return;
  if (n === -1) {
    let l = r;
    if (i.type === 'punc' && (i.value === ')' || i.value === ']')) {
      if (((l = ps(e, r)), l < 0)) return;
      l > 0 && e[l - 1].type === 'ident' && l--;
    } else if (!['ident', 'number', 'string', 'format'].includes(i.type))
      return;
    for (; l > 0; ) {
      let p = e[l];
      if (p.type === 'punc' && (p.value === ')' || p.value === ']')) {
        if (((l = ps(e, l)), l < 0)) return;
        l > 0 &&
          ['ident', 'number', 'string', 'format'].includes(e[l - 1].type) &&
          (l -= 1);
        continue;
      }
      let g = e[l - 1];
      if (g.type === 'op' && (g.value === '.' || g.value === '?.')) {
        let x = e[l - 2],
          w =
            x &&
            x.type === 'punc' &&
            (x.value === ')' || x.value === ']' || x.value === '}');
        if (
          x &&
          (w || ['ident', 'number', 'string', 'format'].includes(x.type))
        ) {
          l -= 2;
          continue;
        }
        l -= 1;
        continue;
      }
      break;
    }
    let c = e[l],
      d = e[r];
    return c.start === void 0 || d.end === void 0
      ? void 0
      : { start: c.start, end: d.end };
  }
  let o = r,
    s = r;
  if (i.type === 'punc' && (i.value === '(' || i.value === '[')) {
    if (((s = Yr(e, o)), s < 0)) return;
  } else if (i.type === 'op' && i.value === '.') {
    if (((s = o + 1), s >= e.length)) return;
  } else if (!['ident', 'number', 'string', 'format'].includes(i.type)) return;
  for (; s + 1 < e.length; ) {
    let l = e[s + 1];
    if (l.type === 'op' && (l.value === '.' || l.value === '?.')) {
      let c = e[s + 2];
      if (c && ['ident', 'number', 'string', 'format'].includes(c.type)) {
        s += 2;
        continue;
      }
      break;
    }
    if (l.type === 'punc' && (l.value === '(' || l.value === '[')) {
      let c = Yr(e, s + 1);
      if (c < 0) break;
      s = c;
      continue;
    }
    break;
  }
  let a = e[o],
    u = e[s];
  if (!(a.start === void 0 || u.end === void 0))
    return { start: a.start, end: u.end };
}
function ps(e, t) {
  let n = e[t].value,
    r = n === ')' ? '(' : n === ']' ? '[' : '{',
    i = 1;
  for (let o = t - 1; o >= 0; o--)
    if (e[o].type === 'punc') {
      if (e[o].value === n) i++;
      else if (e[o].value === r && (i--, i === 0)) return o;
    }
  return -1;
}
function Yr(e, t) {
  let n = e[t].value,
    r = n === '(' ? ')' : n === '[' ? ']' : '}',
    i = 1;
  for (let o = t + 1; o < e.length; o++)
    if (e[o].type === 'punc') {
      if (e[o].value === n) i++;
      else if (e[o].value === r && (i--, i === 0)) return o;
    }
  return -1;
}
function Jl(e, t) {
  let n = e[t - 1];
  return n
    ? !!(
        ['ident', 'number', 'string', 'var', 'format'].includes(n.type) ||
        (n.type === 'punc' && [')', ']', '}'].includes(n.value)) ||
        (n.type === 'op' && ['.', '?.', '?'].includes(n.value))
      )
    : !1;
}
function Zl(e, t) {
  if (!Jl(e, t)) return !1;
  let n = Yr(e, t);
  if (n < 0) return !1;
  let r = e.slice(t + 1, n);
  if (r.length === 0) return !1;
  if (r[0]?.type === 'op' && r[0].value === '*') return !0;
  let i = fe(r, 0, r.length, ',');
  return i.length === 2 && Kr(r.slice(...i[0])) ? !0 : ws(r);
}
function Is(e) {
  let t = new Array(e.length).fill(0),
    n = 0,
    r = [];
  for (let i = 0; i < e.length; i++) {
    t[i] = n;
    let o = e[i];
    if (o.type === 'punc' && o.value === '[') {
      let s = Zl(e, i);
      (r.push(s), s && n++);
      continue;
    }
    o.type === 'punc' && o.value === ']' && r.pop() && n--;
  }
  return t;
}
function Ql(e) {
  let t = _n(e);
  if (!t) return { source: e, changed: !1 };
  let n = [];
  for (let o of t)
    o.type === 'op' &&
      o.value === '!=' &&
      o.raw === '<>' &&
      o.start !== void 0 &&
      o.end !== void 0 &&
      n.push([o.start, o.end]);
  if (n.length === 0) return { source: e, changed: !1 };
  let r = '',
    i = 0;
  for (let [o, s] of n) ((r += e.slice(i, o) + '!='), (i = s));
  return ((r += e.slice(i)), { source: r, changed: !0 });
}
function ec(e) {
  let t = _n(e);
  if (!t) return { source: e, changed: !1 };
  let n = Is(t),
    r = [];
  for (let s = 0; s < t.length; s++) {
    let a = t[s];
    n[s] === 0 &&
      a.type === 'op' &&
      a.value === '=' &&
      a.start !== void 0 &&
      a.end !== void 0 &&
      r.push([a.start, a.end]);
  }
  if (r.length === 0) return { source: e, changed: !1 };
  let i = '',
    o = 0;
  for (let [s, a] of r) ((i += e.slice(o, s) + '=='), (o = a));
  return ((i += e.slice(o)), { source: i, changed: !0 });
}
function tc(e) {
  let t = [],
    n = e,
    r = Hl(n);
  r.changed &&
    (t.push({
      code: 'excel-cell-prefix-stripped',
      message: 'Dropped the leading `=` (Excel cell-formula prefix).',
    }),
    (n = r.source));
  let i = os(n);
  i.changed &&
    (t.push({
      code: 'statistical-dotted-formula-rewritten',
      message:
        'Rewrote dotted statistical FormulaJS names to BXL underscore names.',
    }),
    (n = i.source));
  let o = Ql(n);
  o.changed &&
    (t.push({
      code: 'excel-inequality-rewritten',
      message: 'Rewrote Excel-style `<>` to canonical `!=`.',
    }),
    (n = o.source));
  let s = ec(n);
  s.changed &&
    (t.push({
      code: 'top-level-equals-to-comparison',
      message: 'Converted top-level = to == (BXL comparison).',
    }),
    (n = s.source));
  let a = Kl(n);
  a.changed &&
    (t.push({
      code: 'excel-operator-rewritten',
      message: 'Rewrote Excel-style `^` / `&` operators to BXL equivalents.',
    }),
    (n = a.source));
  let u = Wl(n);
  return (
    u.changed &&
      (t.push({
        code: 'word-binary-operator-rewritten',
        message: 'Rewrote word-form string operators to pipe-form jq calls.',
      }),
      (n = u.source)),
    { source: n, rewrites: t }
  );
}
function vs(e, t = {}) {
  let n = tc(e),
    r = hs(n.source),
    o = new kn(r, { schema: t.schema }).compile(t.schema),
    s = o.needsRootBinding ? `. as $root | ${o.source}` : o.source,
    a = s;
  try {
    let u = nc(s);
    u && (a = u);
  } catch {}
  return { source: a, changed: o.changed || a !== e, warnings: o.warnings };
}
var nc = (e) => e;
var Cn = class extends Error {
  constructor(n, r) {
    super(r);
    this.phase = n;
    this.name = 'NativeJqDialectError';
  }
};
function Rs(e, t) {
  if (t instanceof Cn) return t;
  let n =
    t && typeof t == 'object' && 'message' in t ? String(t.message) : String(t);
  return new Cn(e, n);
}
function rc(e, t = {}) {
  return t.readableSyntax === !1
    ? { source: e, changed: !1, warnings: [] }
    : vs(e, { schema: t.schema });
}
function vt(e, t = {}) {
  return Zr(e, t, !0);
}
function Zr(e, t, n) {
  let r = rc(e, t),
    i = new pe(new Xe(r.source), n);
  try {
    let o = new _e(i).parse();
    return {
      tokens: n ? i.consumedTokens() : [],
      ast: o,
      source: e,
      compiledSource: r.source,
      readableWarnings: r.warnings,
    };
  } catch (o) {
    throw Rs(i.lastErrorPhase, o);
  }
}
function Qr(e, t, n, r) {
  let i = [],
    o = r ? void 0 : e.compiledScalar;
  try {
    let s = mi(() => {
      let a = o ? [o(t)] : Ji(e.ast, [t], n);
      for (let u of a) (hi(u), i.push(u));
    }, r);
    if (s.error && !(s.error instanceof lt)) throw s.error;
    return {
      tokens: e.tokens,
      ast: e.ast,
      source: e.source,
      compiledSource: e.compiledSource,
      readableWarnings: e.readableWarnings,
      outputs: i,
      debugMessages: s.diagnostics.debugMessages,
      stderr: s.diagnostics.stderr,
      haltedExitCode: s.diagnostics.haltedExitCode,
    };
  } catch (s) {
    throw Rs('evaluate', s);
  }
}
function ei(e, t, n = {}) {
  return ic(e, t, n, !0);
}
function ic(e, t, n, r) {
  let i = Zr(e, n, r),
    o = Rn(n.libraries ?? Ze);
  return ((i.compiledScalar = ti(i.ast, o)), Qr(i, t, o, n.runtimeLimits));
}
function oc(e) {
  return e?.type === 'str' && !e.interpolated ? e.value : void 0;
}
function sc(e) {
  return !e || e.type !== 'object'
    ? []
    : e.entries
        .map((t) => (typeof t.key == 'string' ? t.key : void 0))
        .filter((t) => !!t);
}
function ac(e, t, n, r) {
  let i = (s, a) => {
      if (oe(e.args[s], n, r) === 'root') {
        let u = oc(e.args[a]);
        u && t.add(u);
      }
    },
    o = (s) => {
      if (oe(e.args[0], n, r) === 'root') for (let a of sc(e.args[s])) t.add(a);
    };
  switch (e.name) {
    case 'COL/2':
      i(0, 1);
      return;
    case 'SUMIF_BY/4':
    case 'AVERAGEIF_BY/4':
      (i(0, 1), i(0, 2));
      return;
    case 'COUNTIF_BY/3':
      i(0, 1);
      return;
    case 'SUMIFS_BY/3':
    case 'AVERAGEIFS_BY/3':
      (i(0, 1), o(2));
      return;
    case 'COUNTIFS_BY/2':
      o(1);
      return;
    case 'LOOKUP_BY/4':
      (i(0, 1), i(0, 3));
      return;
    case 'NPV_BY/3':
      i(1, 2);
      return;
    case 'IRR_BY/2':
      i(0, 1);
      return;
    case 'IRR_BY/3':
      i(0, 1);
      return;
    case 'XNPV_BY/4':
      (i(1, 2), i(1, 3));
      return;
    case 'XIRR_BY/3':
      (i(0, 1), i(0, 2));
      return;
    case 'XIRR_BY/4':
      (i(0, 1), i(0, 2));
      return;
    case 'VLOOKUP_BY/4':
    case 'VLOOKUP_BY/5':
      (i(0, 1), i(0, 3));
      return;
  }
}
function Ve(e) {
  return { defs: new Map(e.defs), vars: new Map(e.vars) };
}
function uc(e, t) {
  for (let n of t) e.vars.set(n.name, 'derived');
}
function $n(e, t, n) {
  for (let r of t)
    switch (r.type) {
      case 'var':
        e.vars.set(r.name, n);
        break;
      case 'arrayDestructuring':
        $n(e, r.destructuring, 'derived');
        break;
      case 'objectDestructuring':
        for (let i of r.entries)
          i.destructuring
            ? $n(e, [i.destructuring], 'derived')
            : e.vars.set(i.key.name, 'derived');
        break;
    }
}
function Jr(e, t, n, r) {
  for (let i of e)
    switch (i.type) {
      case 'var':
        break;
      case 'arrayDestructuring':
        Jr(i.destructuring, t, n, 'derived');
        break;
      case 'objectDestructuring':
        for (let o of i.entries)
          (r === 'root'
            ? typeof o.key == 'string'
              ? t.add(o.key)
              : o.key.type === 'var' && !o.destructuring
                ? t.add(o.key.name.replace(/^\$/, ''))
                : _(o.key, t, n, r)
            : typeof o.key != 'string' &&
              o.key.type !== 'var' &&
              _(o.key, t, n, r),
            o.destructuring && Jr([o.destructuring], t, n, 'derived'));
        break;
    }
}
function oe(e, t, n) {
  if (!e) return n;
  switch (e.type) {
    case 'identity':
      return n;
    case 'var':
      return t.vars.get(e.name) ?? 'derived';
    case 'def': {
      let r = Ve(t);
      return (r.defs.set(e.name, e), oe(e.next, r, n));
    }
    case 'varDeclaration': {
      let r = oe(e.expr, t, n),
        i = Ve(t);
      return ($n(i, e.destructuring, r), oe(e.next, i, n));
    }
    case 'label':
      return oe(e.next, t, n);
    case 'try':
      return oe(e.body, t, n);
    case 'binary':
      if (e.operator === '|') {
        let r = oe(e.left, t, n);
        return oe(e.right, t, r);
      }
      return 'derived';
    default:
      return 'derived';
  }
}
function _(e, t, n, r) {
  if (e)
    switch (e.type) {
      case 'binary':
        if (e.operator === '|') {
          (_(e.left, t, n, r), _(e.right, t, n, oe(e.left, n, r)));
          return;
        }
        (_(e.left, t, n, r), _(e.right, t, n, r));
        return;
      case 'def': {
        let i = Ve(n);
        (i.defs.set(e.name, e), _(e.next, t, i, r));
        return;
      }
      case 'filter': {
        for (let o of e.args) _(o, t, n, r);
        ac(e, t, n, r);
        let i = n.defs.get(e.name);
        if (i) {
          let o = Ve(n);
          (uc(o, i.args), _(i.body, t, o, r));
        }
        return;
      }
      case 'if':
        (_(e.cond, t, n, r), _(e.then, t, n, r));
        for (let i of e.elifs ?? []) (_(i.cond, t, n, r), _(i.then, t, n, r));
        _(e.else, t, n, r);
        return;
      case 'try':
        (_(e.body, t, n, r), _(e.catch, t, n, r));
        return;
      case 'reduce': {
        (_(e.expr, t, n, r), _(e.init, t, n, r));
        let i = Ve(n);
        (i.vars.set(e.var, 'derived'), _(e.update, t, i, r));
        return;
      }
      case 'foreach': {
        (_(e.expr, t, n, r), _(e.init, t, n, r));
        let i = Ve(n);
        (i.vars.set(e.var, 'derived'),
          _(e.update, t, i, r),
          _(e.extract, t, i, r));
        return;
      }
      case 'varDeclaration': {
        _(e.expr, t, n, r);
        let i = oe(e.expr, n, r);
        Jr(e.destructuring, t, n, i);
        let o = Ve(n);
        ($n(o, e.destructuring, i), _(e.next, t, o, r));
        return;
      }
      case 'label':
        _(e.next, t, n, r);
        return;
      case 'unary':
        _(e.expr, t, n, r);
        return;
      case 'index': {
        (_(e.expr, t, n, r),
          typeof e.index == 'string' && oe(e.expr, n, r) === 'root'
            ? t.add(e.index)
            : typeof e.index != 'string' && _(e.index, t, n, r));
        return;
      }
      case 'slice':
        (_(e.expr, t, n, r), _(e.from, t, n, r), _(e.to, t, n, r));
        return;
      case 'iterator':
        _(e.expr, t, n, r);
        return;
      case 'array':
        _(e.expr, t, n, r);
        return;
      case 'object':
        for (let i of e.entries)
          (typeof i.key != 'string'
            ? _(i.key, t, n, r)
            : !('value' in i) && r === 'root' && t.add(i.key),
            'value' in i && _(i.value, t, n, r));
        return;
      case 'str':
        if (e.interpolated)
          for (let i of e.parts) typeof i != 'string' && _(i, t, n, r);
        return;
      case 'format':
      case 'identity':
      case 'num':
      case 'bool':
      case 'null':
      case 'var':
      case 'break':
      case 'recursiveDescent':
        return;
    }
}
function Ss(e) {
  let t = new Set();
  return (_(e.expr, t, { defs: new Map(), vars: new Map() }, 'root'), [...t]);
}
function B(e, t, n) {
  if (!e) return !0;
  let r = (i) => ((e.singleOutput = i), i);
  switch (e.type) {
    case 'binary': {
      let o = B(e.left, t, n),
        s = B(e.right, t, n);
      return r(
        o &&
          s &&
          ['==', '!=', '<', '>', '<=', '>=', '+', '-', '*', '/', '%'].includes(
            e.operator,
          ),
      );
    }
    case 'def': {
      let o = new Set(n);
      return (o.add(e.name), B(e.body, t, o), r(B(e.next, t, o)));
    }
    case 'filter':
      if (!n.has(e.name)) {
        let o = t.jq[e.name];
        o ? (e.resolvedJq = o) : (e.resolvedNative = t.native[e.name]);
      }
      for (let o of e.args) B(o, t, n);
      return r(!1);
    case 'if':
      (B(e.cond, t, n), B(e.then, t, n));
      for (let o of e.elifs ?? []) (B(o.cond, t, n), B(o.then, t, n));
      return (B(e.else, t, n), r(!1));
    case 'try':
      return (B(e.body, t, n), B(e.catch, t, n), r(!1));
    case 'reduce':
    case 'foreach':
      return (
        B(e.expr, t, n),
        B(e.init, t, n),
        B(e.update, t, n),
        e.type === 'foreach' && B(e.extract, t, n),
        r(!1)
      );
    case 'varDeclaration':
      return (B(e.expr, t, n), r(!1));
    case 'label':
      return r(B(e.next, t, n));
    case 'unary':
      return r(B(e.expr, t, n));
    case 'index':
      let i = B(e.expr, t, n);
      return typeof e.index != 'string' ? r(i && B(e.index, t, n)) : r(i);
    case 'slice':
      return (B(e.expr, t, n), B(e.from, t, n), B(e.to, t, n), r(!1));
    case 'iterator':
      return (B(e.expr, t, n), r(!1));
    case 'array':
      return (B(e.expr, t, n), r(!1));
    case 'object':
      for (let o of e.entries)
        (typeof o.key != 'string' && B(o.key, t, n),
          'value' in o && B(o.value, t, n));
      return r(!1);
    case 'str':
      if (e.interpolated) {
        for (let o of e.parts) typeof o != 'string' && B(o, t, n);
        return r(!1);
      }
      return r(!0);
    case 'format':
    case 'identity':
    case 'num':
    case 'bool':
    case 'null':
    case 'var':
      return r(!0);
    case 'break':
    case 'recursiveDescent':
      return r(!1);
  }
}
function ti(e, t) {
  return (B(e.expr, t, new Set()), Y(e.expr));
}
function Lo(e, t = {}) {
  return lc(e, t, !0);
}
function Uo(e, t = {}) {
  let n = {
      tokens: [],
      ast: { type: 'root', expr: e },
      source: '<prepared BXL expression>',
      compiledSource: '<prepared BXL expression>',
      readableWarnings: [],
    },
    r = Rn(t.libraries ?? Ze);
  n.compiledScalar = ti(n.ast, r);
  let i = Ss(n.ast);
  return {
    ...n,
    deps: i,
    run(o, s = {}) {
      return Qr(n, o, r, s.runtimeLimits ?? t.runtimeLimits);
    },
  };
}
function lc(e, t, n) {
  let r = Zr(e, t, n),
    i = Rn(t.libraries ?? Ze);
  r.compiledScalar = ti(r.ast, i);
  let o = Ss(r.ast);
  return {
    ...r,
    deps: o,
    run(s, a = {}) {
      return Qr(r, s, i, a.runtimeLimits ?? t.runtimeLimits);
    },
  };
}
function Um(e, t, n = {}) {
  let r;
  try {
    r = ei(e, t, {
      schema: n.schema,
      readableSyntax: n.readableSyntax,
      libraries: ['core'],
      runtimeLimits: n.runtimeLimits,
    });
  } catch (i) {
    let s = (i instanceof Error ? i.message : String(i)).match(
      /'([A-Z][A-Z0-9_]*\/\d+)' is not defined/,
    );
    throw s
      ? new Error(
          `runtime-bare contains jq core only; ${s[1]} is a spreadsheet formula. Import from '@cardstack/bxl/runtime' (or the main '@cardstack/bxl' entry) to enable the formula library.`,
        )
      : i;
  }
  return r.outputs.length === 0
    ? null
    : r.outputs.length === 1
      ? r.outputs[0]
      : r.outputs;
}
export {
  Kt as CORE_REGISTRY,
  Um as evaluateBxlBare,
  or as resolveCoreRegistry,
  ei as runNativeJq,
};
