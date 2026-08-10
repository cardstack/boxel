// Suggest a semver bump by comparing two versions' exported surface.
//
// This is the STRUCTURAL PASS from `deck-version-is-a-proposal.md` §3.1: the
// part of "is this breaking?" that can be decided mechanically, deterministic
// and cheap, so a proposal arrives with its bump already argued.
//
// WHAT IT IS FOR. Whoever publishes currently decides major-versus-minor
// alone and nothing checks them — the most consequential judgement in the
// system, with no second pair of eyes. This gives a reviewer a starting
// position they can audit, rather than asking them to derive it by reading
// two files every time.
//
// WHAT IT DELIBERATELY IS NOT. It reads the exported SURFACE — which names
// exist, and how many required parameters each takes. It does not read
// bodies, so it cannot see a change in what a parameter MEANS. That gap is
// not a defect to be patched with more regex; it is the boundary in §3.2 and
// the reason a model is in the loop at all. `verdict.blindTo` names it on
// every result, so a caller can never mistake "no structural break" for "not
// breaking".
//
// The verdict is a FLOOR. A reviewer or a model may raise it and may not
// lower it: a wrong "minor" ships a break to everyone on a caret range, a
// wrong "major" costs one unnecessary bump.

export type Bump = 'major' | 'minor' | 'patch';

export interface SurfaceMember {
  name: string;
  kind: 'function' | 'binding';
  /** Required parameters — those before any `=` default or `...rest`. */
  required?: number;
  /** Total declared parameters, required or not. */
  declared?: number;
}

export interface DeltaReason {
  bump: Bump;
  member: string;
  detail: string;
}

export interface Verdict {
  bump: Bump;
  reasons: DeltaReason[];
  /** What this pass structurally cannot see. Always populated. */
  blindTo: string;
}

const BLIND =
  'Only the exported surface was compared. A parameter whose MEANING ' +
  'changed — same name, same arity, different interpretation — is invisible ' +
  'here and needs the bodies read.';

// Exported declarations, in the forms a hand-written library actually uses.
// Not a parser: a parser is the right answer once this leaves the demo, and
// pretending otherwise with a longer regex would be the mistake the ES lexer
// was written to undo. What it covers is stated so a reader knows the edges:
//
//   export function f(a, b = 1) {}
//   export const NAME = …            export let / var
//   export class C {}
//   export { a, b as c }
//
// It does not cover `export default`, re-exports from another module, or a
// binding whose name is computed. Those return no member rather than a wrong
// one — silence is recoverable, a fabricated signature is not.
const EXPORT_FN =
  /\bexport\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;
const EXPORT_BINDING =
  /\bexport\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST = /\bexport\s*\{([^}]*)\}/g;

function countParams(raw: string): { required: number; declared: number } {
  let trimmed = raw.trim();
  if (!trimmed) {
    return { required: 0, declared: 0 };
  }
  // Split on top-level commas only: a default value may itself contain a
  // comma inside an object, array or call.
  let parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let char of trimmed) {
    if (char === '(' || char === '[' || char === '{') depth++;
    if (char === ')' || char === ']' || char === '}') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  let declared = parts.filter((p) => p.trim()).length;
  // A parameter is required until a default or a rest appears. Everything
  // after the first optional one is optional too, which is what makes
  // "appended an optional parameter" a minor rather than a major.
  let required = 0;
  for (let part of parts) {
    let p = part.trim();
    if (!p) continue;
    if (p.startsWith('...') || p.includes('=')) break;
    required++;
  }
  return { required, declared };
}

export function readSurface(source: string): SurfaceMember[] {
  let members = new Map<string, SurfaceMember>();
  for (let match of source.matchAll(EXPORT_FN)) {
    let { required, declared } = countParams(match[2] ?? '');
    members.set(match[1], {
      name: match[1],
      kind: 'function',
      required,
      declared,
    });
  }
  for (let match of source.matchAll(EXPORT_BINDING)) {
    if (!members.has(match[1])) {
      members.set(match[1], { name: match[1], kind: 'binding' });
    }
  }
  for (let match of source.matchAll(EXPORT_LIST)) {
    for (let entry of (match[1] ?? '').split(',')) {
      // `a as b` exports the name `b`; that is what a consumer imports.
      let name = entry
        .split(/\bas\b/)
        .pop()
        ?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name) && !members.has(name)) {
        members.set(name, { name, kind: 'binding' });
      }
    }
  }
  return [...members.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const RANK: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };

export function suggestBump(before: string, after: string): Verdict {
  let prior = new Map(readSurface(before).map((m) => [m.name, m]));
  let next = new Map(readSurface(after).map((m) => [m.name, m]));
  let reasons: DeltaReason[] = [];

  for (let [name, was] of prior) {
    let now = next.get(name);
    if (!now) {
      reasons.push({
        bump: 'major',
        member: name,
        detail: 'export removed — every caller of it breaks',
      });
      continue;
    }
    if (was.kind === 'function' && now.kind === 'function') {
      if ((now.required ?? 0) > (was.required ?? 0)) {
        reasons.push({
          bump: 'major',
          member: name,
          detail: `now requires ${now.required} parameter(s), was ${was.required} — existing calls are short`,
        });
      } else if ((now.declared ?? 0) > (was.declared ?? 0)) {
        reasons.push({
          bump: 'minor',
          member: name,
          detail: `gained an optional parameter (${was.declared} → ${now.declared})`,
        });
      }
    } else if (was.kind !== now.kind) {
      reasons.push({
        bump: 'major',
        member: name,
        detail: `changed from ${was.kind} to ${now.kind}`,
      });
    }
  }

  for (let name of next.keys()) {
    if (!prior.has(name)) {
      reasons.push({
        bump: 'minor',
        member: name,
        detail: 'new export — additive, nothing existing depends on it',
      });
    }
  }

  let bump = reasons.reduce<Bump>(
    (worst, r) => (RANK[r.bump] > RANK[worst] ? r.bump : worst),
    'patch',
  );
  return { bump, reasons, blindTo: BLIND };
}
