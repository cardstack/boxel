import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { runNativeJq, type NativeRuntimeLimits } from '../../src/index.ts';

// Each expectation below is jq 1.7.1's answer.

function outputs(program: string, input: unknown = null): unknown[] {
  return runNativeJq(program, input).outputs;
}

function attempt(
  program: string,
  input: unknown,
  runtimeLimits?: NativeRuntimeLimits,
): { outputs?: unknown[]; error?: unknown } {
  try {
    const run = runNativeJq(program, input, { runtimeLimits });
    return { outputs: run.outputs, error: (run as { error?: unknown }).error };
  } catch (error) {
    return { error };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// 1. Object lookups must not see Object.prototype.
deepStrictEqual(outputs('{"a":1} | .["toString"] | type'), ['null']);
deepStrictEqual(outputs('{"a":1} | has("toString")'), [false]);
deepStrictEqual(outputs('{} | .constructor | type'), ['null']);
deepStrictEqual(outputs('.toString | type', { a: 1 }), ['null']);
deepStrictEqual(outputs('.toString', { a: 1 }), [null]);
deepStrictEqual(outputs('{a:1} | {x: .toString}'), [{ x: null }]);
deepStrictEqual(outputs('{"constructor": 5} | .constructor'), [5]);
deepStrictEqual(outputs('{"constructor": 5} | has("constructor")'), [true]);
deepStrictEqual(outputs('{} | getpath(["toString"])'), [null]);
deepStrictEqual(outputs('{} | setpath(["__proto__","polluted"]; 1) | tojson'), [
  '{"__proto__":{"polluted":1}}',
]);
deepStrictEqual(
  outputs('{} | setpath(["__proto__","polluted"]; 1) | .["__proto__"]'),
  [{ polluted: 1 }],
);
strictEqual(
  ({} as { polluted?: unknown }).polluted,
  undefined,
  'Object.prototype must not be polluted by a path write',
);
deepStrictEqual(outputs('{} | del(.toString) | tojson'), ['{}']);
deepStrictEqual(outputs('{"a":{"b":1}} | .a.toString'), [null]);
deepStrictEqual(outputs('{"a":{"b":1}} | .a.b'), [1]);

// 2. Keywords are fields when they follow the dot directly.
deepStrictEqual(outputs('.label', { label: 7 }), [7]);
deepStrictEqual(outputs('.if', { if: 1 }), [1]);
deepStrictEqual(outputs('.end', { end: 2 }), [2]);
deepStrictEqual(outputs('.reduce', { reduce: 3 }), [3]);
deepStrictEqual(outputs('.as', { as: 4 }), [4]);
deepStrictEqual(outputs('{label: 1}'), [{ label: 1 }]);
deepStrictEqual(outputs('.label as $l | $l', { label: 7 }), [7]);
deepStrictEqual(outputs('. as $x | $x', 9), [9]);
deepStrictEqual(outputs('[1,2] | reduce .[] as $x (0; . + $x)'), [3]);
deepStrictEqual(outputs('.a.label', { a: { label: 'x' } }), ['x']);
deepStrictEqual(outputs('.[] | .label', [{ label: 1 }, { label: 2 }]), [1, 2]);

// 3. An escaped backslash before a parenthesis is not interpolation.
deepStrictEqual(outputs('"a(b)" | test("\\\\(")'), [true]);
deepStrictEqual(outputs('"\\\\("'), ['\\(']);
deepStrictEqual(outputs('"\\\\\\\\("'), ['\\\\(']);
deepStrictEqual(outputs('"\\(1)"'), ['1']);
deepStrictEqual(outputs('"x\\\\(y) \\(1 + 1)"'), ['x\\(y) 2']);

// 4. \u escapes, including a surrogate pair and the JSON solidus escape.
deepStrictEqual(outputs('"\\u0060"'), ['`']);
deepStrictEqual(outputs('"caf\\u00e9"'), ['café']);
deepStrictEqual(outputs('"\\ud83d\\ude00"'), ['😀']);
deepStrictEqual(outputs('"a\\/b"'), ['a/b']);
// The jq tokenizer rejects a short escape. (The readable pre-pass keeps a
// malformed escape as text, so this is checked on the plain jq route.)
ok(
  /hex digits/.test(
    message(
      (() => {
        try {
          runNativeJq('"\\u12"', null, { readableSyntax: false });
          return undefined;
        } catch (error) {
          return error;
        }
      })(),
    ),
  ),
);

// 5. The millisecond limit measures the configured clock, not host load.
const heavy = '[range(30000)] | length';
deepStrictEqual(
  attempt(heavy, null, { maxMillis: 1, clock: () => 0 }).outputs,
  [30000],
  'a clock that does not advance never trips the wall-clock limit',
);
let ticks = 0;
const tripped = attempt(heavy, null, {
  maxMillis: 1,
  clock: () => (ticks += 10),
});
ok(tripped.error, 'an advancing clock still enforces maxMillis');
ok(/maxMillis|runtime limit/.test(message(tripped.error)));
deepStrictEqual(
  attempt(heavy, null, { maxMillis: 60_000, clock: 'cpu' }).outputs,
  [30000],
  'the cpu clock runs a step-bounded program',
);

// 6. gsub replaces every occurrence and exposes named captures to the
//    replacement.
deepStrictEqual(outputs('"abc123def456ghi" | gsub("[0-9]"; "")'), [
  'abcdefghi',
]);
deepStrictEqual(outputs('"a-b-c" | gsub("-"; "+")'), ['a+b+c']);
deepStrictEqual(
  outputs(
    '"2026-09-15" | gsub("(?<y>\\\\d{4})-(?<m>\\\\d{2})"; "\\(.m)/\\(.y)")',
  ),
  ['09/2026-15'],
);

// 7. strftime honours the `-` no-padding flag and names format errors.
const march4 = 1741046400; // 2025-03-04T00:00:00Z
deepStrictEqual(outputs(`${march4} | strftime("%-d")`), ['4']);
deepStrictEqual(outputs(`${march4} | strftime("%d")`), ['04']);
deepStrictEqual(outputs(`${march4} | strftime("%-m/%-d/%Y")`), ['3/4/2025']);
deepStrictEqual(outputs(`${march4} | strftime("%-H:%-M:%-S")`), ['0:0:0']);
deepStrictEqual(outputs(`${march4} | strftime("%-j")`), ['63']);
deepStrictEqual(outputs(`${march4} | strftime("%e")`), [' 4']);
deepStrictEqual(outputs(`${march4} | gmtime | strftime("%-d")`), ['4']);
ok(
  /format directive: %Q/.test(
    message(attempt(`${march4} | strftime("%Q")`, null).error),
  ),
  'a bad directive is reported as a format error',
);

console.log(
  'jq conformance: prototype, keywords, escapes, clock, gsub, strftime flag',
);
