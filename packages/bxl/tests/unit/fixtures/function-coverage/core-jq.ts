import { deepStrictEqual } from 'node:assert';
import { jqCases, type CoverageCase } from './case.ts';

/** jq's broken-down time: the eight fields `gmtime` and `localtime` yield. */
function brokenDownTime(wallClock: Date) {
  return [
    wallClock.getUTCFullYear(),
    wallClock.getUTCMonth(),
    wallClock.getUTCDate(),
    wallClock.getUTCHours(),
    wallClock.getUTCMinutes(),
    wallClock.getUTCSeconds(),
    wallClock.getUTCDay(),
    Math.floor(
      (Date.UTC(
        wallClock.getUTCFullYear(),
        wallClock.getUTCMonth(),
        wallClock.getUTCDate(),
      ) -
        Date.UTC(wallClock.getUTCFullYear(), 0, 1)) /
        86_400_000,
    ),
  ];
}

export const coreJqCases: CoverageCase[] = jqCases([
  // Type filters: each keeps the inputs of one jq type and drops the rest.
  { covers: 'arrays/0', source: '[(1, [2], "x") | arrays]', expected: [[2]] },
  {
    covers: 'objects/0',
    source: '[(1, {"a":1}, [2]) | objects]',
    expected: [{ a: 1 }],
  },
  {
    covers: 'iterables/0',
    source: '[(1, [2], {"a":1}) | iterables]',
    expected: [[2], { a: 1 }],
  },
  {
    covers: 'booleans/0',
    source: '[(1, true, false, "x") | booleans]',
    expected: [true, false],
  },
  { covers: 'numbers/0', source: '[(1, "a", null) | numbers]', expected: [1] },
  { covers: 'strings/0', source: '[(1, "a") | strings]', expected: ['a'] },
  { covers: 'nulls/0', source: '[(null, 1) | nulls]', expected: [null] },
  // `values` keeps everything except null, so `false` survives it.
  {
    covers: 'values/0',
    source: '[(null, 1, false) | values]',
    expected: [1, false],
  },
  {
    covers: 'scalars/0',
    source: '[(1, "a", [2], {"b":1}, null, true) | scalars]',
    expected: [1, 'a', null, true],
  },
  {
    covers: 'scalars_or_empty/0',
    // The name is the contract: scalars, or an EMPTY collection. That is the
    // only thing separating it from `scalars`, so the input has to contain an
    // empty array and object as well as a populated one.
    source: '[(1, [2], [], {}) | scalars_or_empty]',
    expected: [1, [], {}],
  },
  { covers: 'finites/0', source: '[(1, infinite) | finites]', expected: [1] },
  // Zero is finite but subnormal-or-zero, so it is not "normal".
  { covers: 'normals/0', source: '[(0, 1) | normals]', expected: [1] },
  {
    covers: 'select/1',
    source: '[.[] | select(. > 1)]',
    input: [1, 2, 3],
    expected: [2, 3],
  },
  { covers: 'not/0', source: 'false | not', expected: true },
  { covers: 'not/0', source: 'true | not', expected: false },
  { covers: 'type/0', source: '[] | type', expected: 'array' },
  { covers: 'length/0', source: 'length', input: { a: 1, b: 2 }, expected: 2 },
  { covers: 'length/0', source: 'null | length', expected: 0 },

  // Objects and arrays.
  {
    covers: 'keys/0',
    source: 'keys',
    input: { b: 1, a: 2 },
    expected: ['a', 'b'],
  },
  {
    covers: 'keys_unsorted/0',
    source: 'keys_unsorted',
    input: { b: 1, a: 2 },
    expected: ['b', 'a'],
  },
  { covers: 'has/1', source: 'has("a")', input: { a: 1 }, expected: true },
  { covers: 'has/1', source: 'has("b")', input: { a: 1 }, expected: false },
  { covers: 'in/1', source: '"a" | in({"a":1})', expected: true },
  { covers: 'in/1', source: '"b" | in({"a":1})', expected: false },
  {
    covers: 'to_entries/0',
    source: 'to_entries',
    input: { a: 1 },
    expected: [{ key: 'a', value: 1 }],
  },
  {
    covers: 'from_entries/0',
    source: 'from_entries',
    input: [{ key: 'a', value: 1 }],
    expected: { a: 1 },
  },
  {
    covers: 'with_entries/1',
    source: 'with_entries(.value += 10)',
    input: { a: 1 },
    expected: { a: 11 },
  },
  { covers: 'map/1', source: 'map(. * 2)', input: [1, 2], expected: [2, 4] },
  {
    covers: 'map_values/1',
    source: 'map_values(. + 1)',
    input: { a: 1, b: 2 },
    expected: { a: 2, b: 3 },
  },
  {
    covers: 'reverse/0',
    source: 'reverse',
    input: [1, 2, 3],
    expected: [3, 2, 1],
  },
  {
    covers: 'flatten/0',
    source: 'flatten',
    input: [1, [2, [3]]],
    expected: [1, 2, 3],
  },
  {
    covers: 'flatten/1',
    source: 'flatten(1)',
    input: [1, [2, [3]]],
    expected: [1, 2, [3]],
  },
  {
    covers: 'transpose/0',
    source: 'transpose',
    input: [[1, 2], [3]],
    expected: [
      [1, 3],
      [2, null],
    ],
  },
  {
    covers: 'combinations/0',
    source: '[combinations]',
    input: [[1, 2], ['a']],
    expected: [
      [1, 'a'],
      [2, 'a'],
    ],
  },
  // combinations/1 takes the cartesian product of the input with itself n times.
  {
    covers: 'combinations/1',
    source: '[combinations(2)]',
    input: [0, 1],
    expected: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
  },
  {
    covers: 'walk/1',
    source: 'walk(if type == "array" then sort else . end)',
    input: { a: [3, 1] },
    expected: { a: [1, 3] },
  },
  // `contains` is recursive and substring-based: "bar" is inside "foobar".
  {
    covers: 'contains/1',
    source: 'contains(["bar"])',
    input: ['foobar', 'baz'],
    expected: true,
  },
  {
    covers: 'contains/1',
    source: 'contains(["nope"])',
    input: ['foobar', 'baz'],
    expected: false,
  },
  { covers: 'inside/1', source: '"bar" | inside("foobar")', expected: true },
  { covers: 'inside/1', source: '"baz" | inside("foobar")', expected: false },
  {
    covers: 'indices/1',
    source: 'indices([1,2])',
    input: [0, 1, 2, 1, 2],
    expected: [1, 3],
  },
  { covers: 'index/1', source: '"banana" | index("na")', expected: 2 },
  { covers: 'rindex/1', source: '"banana" | rindex("na")', expected: 4 },

  // Paths.
  {
    covers: 'path/1',
    source: 'path(.a.b)',
    input: { a: { b: 1 } },
    expected: ['a', 'b'],
  },
  {
    covers: 'paths/0',
    source: '[paths]',
    input: { a: [1] },
    expected: [['a'], ['a', 0]],
  },
  {
    covers: 'paths/1',
    source: '[paths(numbers)]',
    input: { a: [1], b: 'x' },
    expected: [['a', 0]],
  },
  {
    covers: 'leaf_paths/0',
    source: '[leaf_paths]',
    input: { a: { b: 1 } },
    expected: [['a', 'b']],
  },
  {
    covers: 'getpath/1',
    source: 'getpath(["a","b"])',
    input: { a: { b: 5 } },
    expected: 5,
  },
  {
    covers: 'getpath/1',
    source: 'getpath(["x","y"])',
    input: { a: 1 },
    expected: null,
  },
  {
    covers: 'setpath/2',
    source: 'setpath(["b","c"]; 2)',
    input: { a: 1 },
    expected: { a: 1, b: { c: 2 } },
  },
  {
    covers: 'del/1',
    source: 'del(.a)',
    input: { a: 1, b: 2 },
    expected: { b: 2 },
  },
  {
    covers: 'delpaths/1',
    source: 'delpaths([["a","b"],["c"]])',
    input: { a: { b: 1 }, c: 2 },
    expected: { a: {} },
  },
  {
    covers: 'pick/1',
    source: 'pick(.a, .c)',
    input: { a: 1, b: 2, c: 3 },
    expected: { a: 1, c: 3 },
  },

  // Aggregation and ordering.
  { covers: 'add/0', source: 'add', input: [1, 2, 3], expected: 6 },
  {
    covers: 'add/1',
    source: 'add(.[].v)',
    input: [{ v: 1 }, { v: 2 }],
    expected: 3,
  },
  { covers: 'sort/0', source: 'sort', input: [3, 1, 2], expected: [1, 2, 3] },
  // jq's total order across types: null, booleans, numbers, strings, arrays, objects.
  {
    covers: 'sort/0',
    source: 'sort',
    input: [{}, [], 'a', 1, true, null],
    expected: [null, true, 1, 'a', [], {}],
  },
  {
    covers: 'sort_by/1',
    source: 'sort_by(.v)',
    input: [
      { n: 'a', v: 2 },
      { n: 'b', v: 1 },
    ],
    expected: [
      { n: 'b', v: 1 },
      { n: 'a', v: 2 },
    ],
  },
  // Ordering by a key that disagrees with the items' own order: sorting these
  // strings by their own value gives a, bbb, cc, so only a key-driven
  // comparison puts them in length order.
  {
    covers: 'sort_by/1',
    source: 'sort_by(length)',
    input: ['bbb', 'a', 'cc'],
    expected: ['a', 'cc', 'bbb'],
  },
  {
    covers: 'group_by/1',
    source: 'group_by(. % 2)',
    input: [1, 2, 3, 4],
    expected: [
      [2, 4],
      [1, 3],
    ],
  },
  {
    covers: 'unique/0',
    source: 'unique',
    input: [2, 1, 2, 3],
    expected: [1, 2, 3],
  },
  // unique_by keeps the first member of each group, and groups sort by key.
  {
    covers: 'unique_by/1',
    source: 'unique_by(. % 2)',
    input: [1, 2, 3, 4],
    expected: [2, 1],
  },
  { covers: 'max/0', source: 'max', input: [3, 1, 2], expected: 3 },
  { covers: 'min/0', source: 'min', input: [3, 1, 2], expected: 1 },
  { covers: 'max/0', source: 'max', input: [], expected: null },
  {
    covers: 'max_by/1',
    source: 'max_by(.v)',
    input: [{ v: 1 }, { v: 5 }, { v: 3 }],
    expected: { v: 5 },
  },
  {
    covers: 'min_by/1',
    source: 'min_by(.v)',
    input: [{ v: 4 }, { v: 2 }],
    expected: { v: 2 },
  },
  // The two disagree on ties: max_by keeps the last item holding the winning
  // key, min_by the first. Asserted because either could plausibly be picked.
  {
    covers: 'max_by/1',
    source: 'max_by(.v)',
    input: [
      { v: 2, i: 0 },
      { v: 2, i: 1 },
    ],
    expected: { v: 2, i: 1 },
  },
  {
    covers: 'min_by/1',
    source: 'min_by(.v)',
    input: [
      { v: 2, i: 0 },
      { v: 2, i: 1 },
    ],
    expected: { v: 2, i: 0 },
  },
  // An empty array has a null extreme rather than no answer at all, matching
  // what max/0 and min/0 report.
  { covers: 'max_by/1', source: '[] | max_by(.)', expected: null },
  { covers: 'min_by/1', source: '[] | min_by(.)', expected: null },
  // bsearch returns the hit index, or -1 - insertionPoint when the target is absent.
  { covers: 'bsearch/1', source: '[1,3,5] | bsearch(4)', expected: -3 },
  { covers: 'all/0', source: 'all', input: [true, false], expected: false },
  { covers: 'all/0', source: 'all', input: [true, true], expected: true },
  { covers: 'all/1', source: 'all(. > 0)', input: [1, 2], expected: true },
  { covers: 'all/1', source: 'all(. > 0)', input: [1, -1], expected: false },
  { covers: 'all/2', source: 'all(range(3); . < 2)', expected: false },
  { covers: 'all/2', source: 'all(range(3); . < 3)', expected: true },
  { covers: 'any/0', source: 'any', input: [false, true], expected: true },
  { covers: 'any/0', source: 'any', input: [false, false], expected: false },
  { covers: 'any/1', source: 'any(. > 1)', input: [1, 2], expected: true },
  { covers: 'any/1', source: 'any(. > 1)', input: [0, 1], expected: false },
  { covers: 'any/2', source: 'any(range(3); . == 2)', expected: true },
  { covers: 'any/2', source: 'any(range(3); . == 5)', expected: false },
  { covers: 'isempty/1', source: 'isempty(empty)', expected: true },
  { covers: 'isempty/1', source: 'isempty(1)', expected: false },

  // Generators and control flow.
  { covers: 'empty/0', source: '1, empty, 2', outputs: [1, 2] },
  { covers: 'range/1', source: '[range(3)]', expected: [0, 1, 2] },
  { covers: 'range/2', source: '[range(1;4)]', expected: [1, 2, 3] },
  { covers: 'range/3', source: '[range(0;10;3)]', expected: [0, 3, 6, 9] },
  { covers: 'first/0', source: 'first', input: [7, 8], expected: 7 },
  { covers: 'first/1', source: 'first(range(5))', expected: 0 },
  { covers: 'last/0', source: 'last', input: [7, 8], expected: 8 },
  { covers: 'last/1', source: 'last(range(3))', expected: 2 },
  { covers: 'nth/1', source: 'nth(1)', input: [7, 8, 9], expected: 8 },
  { covers: 'nth/2', source: 'nth(2; range(5))', expected: 2 },
  { covers: 'limit/2', source: '[limit(2; range(5))]', expected: [0, 1] },
  { covers: 'skip/2', source: '[skip(3; range(5))]', expected: [3, 4] },
  {
    covers: 'recurse/0',
    source: '[recurse]',
    input: [[1]],
    expected: [[[1]], [1], 1],
  },
  {
    covers: 'recurse/1',
    source: '1 | [recurse(if . < 4 then . + 1 else empty end)]',
    expected: [1, 2, 3, 4],
  },
  {
    covers: 'recurse/2',
    source: '1 | [recurse(. + 2; . < 7)]',
    expected: [1, 3, 5],
  },
  {
    covers: 'recurse_down/0',
    source: '[recurse_down]',
    input: [[1]],
    expected: [[[1]], [1], 1],
  },
  { covers: 'while/2', source: '1 | [while(. < 5; . + 2)]', expected: [1, 3] },
  { covers: 'until/2', source: '1 | until(. > 5; . + 2)', expected: 7 },
  // `repeat` re-applies its argument to the original input, so a doubling
  // step emits 2 forever rather than 2, 4, 8.
  {
    covers: 'repeat/1',
    source: '1 | [limit(3; repeat(. * 2))]',
    expected: [2, 2, 2],
  },

  // Strings.
  {
    covers: 'startswith/1',
    source: '"foobar" | startswith("foo")',
    expected: true,
  },
  {
    covers: 'startswith/1',
    source: '"foobar" | startswith("bar")',
    expected: false,
  },
  {
    covers: 'endswith/1',
    source: '"foobar" | endswith("bar")',
    expected: true,
  },
  {
    covers: 'endswith/1',
    source: '"foobar" | endswith("foo")',
    expected: false,
  },
  {
    covers: 'ltrimstr/1',
    source: '"foobar" | ltrimstr("foo")',
    expected: 'bar',
  },
  // A prefix that does not match leaves the string alone rather than failing.
  {
    covers: 'ltrimstr/1',
    source: '"foobar" | ltrimstr("zzz")',
    expected: 'foobar',
  },
  {
    covers: 'rtrimstr/1',
    source: '"foobar" | rtrimstr("bar")',
    expected: 'foo',
  },
  { covers: 'trimstr/1', source: '"abXab" | trimstr("ab")', expected: 'X' },
  { covers: 'trim/0', source: '"  ab  " | trim', expected: 'ab' },
  { covers: 'ltrim/0', source: '"  ab  " | ltrim', expected: 'ab  ' },
  { covers: 'rtrim/0', source: '"  ab  " | rtrim', expected: '  ab' },
  // Only A-Z and a-z shift; other alphabets pass through untouched.
  {
    covers: 'ascii_downcase/0',
    source: '"AbÉ" | ascii_downcase',
    expected: 'abÉ',
  },
  { covers: 'ascii_upcase/0', source: '"aBé" | ascii_upcase', expected: 'ABé' },
  { covers: 'explode/0', source: '"aé" | explode', expected: [97, 233] },
  { covers: 'implode/0', source: 'implode', input: [72, 105], expected: 'Hi' },
  {
    covers: 'split/1',
    source: '"a,b,c" | split(",")',
    expected: ['a', 'b', 'c'],
  },
  {
    covers: 'join/1',
    source: 'join(",")',
    input: [1, null, 'a', true],
    expected: '1,,a,true',
  },
  { covers: 'utf8bytelength/0', source: '"€" | utf8bytelength', expected: 3 },

  // Regular expressions. split/2 and splits/* take a regex, unlike split/1.
  {
    covers: 'match/1',
    source: '"abc" | match("b")',
    expected: { offset: 1, length: 1, string: 'b', captures: [] },
  },
  // A named group carries its name onto the match, which is where `capture`,
  // `sub` and `gsub` all read it from — so it is asserted at that root as
  // well as through each of them.
  {
    covers: 'match/1',
    source: '"abc123" | match("(?<num>[0-9]+)") | .captures[0].name',
    expected: 'num',
  },
  {
    covers: 'match/2',
    source: '"aA" | [match("a"; "gi") | .offset]',
    expected: [0, 1],
  },
  // An optional group that did not take part still occupies its slot, with no
  // text and no position.
  {
    covers: 'match/1',
    source: '"abc" | match("(x)?(b)") | .captures[0]',
    expected: { offset: -1, length: 0, string: null, name: null },
  },
  // Capture names are read off the pattern by counting group openings, so the
  // count has to skip the parentheses that are not groups: one inside a
  // character class, and the one opening a lookbehind.
  {
    covers: 'match/1',
    source: '"a(b" | match("[(](?<x>b)") | .captures[0].name',
    expected: 'x',
  },
  {
    covers: 'match/1',
    source: '"ab" | match("(?<=a)(?<x>b)") | .captures[0].name',
    expected: 'x',
  },
  { covers: 'test/1', source: '"abc" | test("b.")', expected: true },
  { covers: 'test/1', source: '"abc" | test("z.")', expected: false },
  { covers: 'test/2', source: '"ABC" | test("abc"; "i")', expected: true },
  // Without the ignore-case flag the same pattern no longer matches.
  { covers: 'test/2', source: '"ABC" | test("abc"; "g")', expected: false },
  {
    covers: 'capture/1',
    source: '"abc123" | capture("(?<num>[0-9]+)")',
    expected: { num: '123' },
  },
  {
    covers: 'capture/2',
    source: '"XYZ" | capture("(?<low>xyz)"; "i")',
    expected: { low: 'XYZ' },
  },
  {
    covers: 'scan/1',
    source: '"abcabc" | [scan("a.")]',
    expected: ['ab', 'ab'],
  },
  // scan/2 always searches globally; the flags argument only adds to that.
  { covers: 'scan/2', source: '"aA" | [scan("a"; "i")]', expected: ['a', 'A'] },
  { covers: 'sub/2', source: '"aaa" | sub("a"; "b")', expected: 'baa' },
  { covers: 'sub/3', source: '"Aaa" | sub("a"; "b"; "i")', expected: 'baa' },
  { covers: 'gsub/2', source: '"aBa" | gsub("a"; "-")', expected: '-B-' },
  // A replacement can read the named captures of the match it is replacing,
  // which is the same capture plumbing `capture` reads.
  {
    covers: 'sub/2',
    source: '"abc" | sub("(?<x>b)"; "[" + .x + "]")',
    expected: 'a[b]c',
  },
  {
    covers: 'gsub/2',
    source: '"abc" | gsub("(?<x>b)"; "<" + .x + ">")',
    expected: 'a<b>c',
  },
  { covers: 'gsub/3', source: '"aBa" | gsub("b"; "-"; "i")', expected: 'a-a' },
  {
    covers: 'split/2',
    source: '"xaybAz" | split("a"; "i")',
    expected: ['x', 'yb', 'z'],
  },
  {
    covers: 'splits/1',
    source: '"a, b,c" | [splits(", *")]',
    expected: ['a', 'b', 'c'],
  },
  {
    covers: 'splits/2',
    source: '"xaybAz" | [splits("a"; "i")]',
    expected: ['x', 'yb', 'z'],
  },

  // JSON and conversion.
  {
    covers: 'tostring/0',
    source: 'tostring',
    input: [1, 'a'],
    expected: '[1,"a"]',
  },
  { covers: 'tonumber/0', source: '"3.5" | tonumber', expected: 3.5 },
  { covers: 'toboolean/0', source: '"true" | toboolean', expected: true },
  { covers: 'toboolean/0', source: '"false" | toboolean', expected: false },
  {
    covers: 'tojson/0',
    source: 'tojson',
    input: { a: [1, 'b'] },
    expected: '{"a":[1,"b"]}',
  },
  {
    covers: 'fromjson/0',
    source: 'fromjson',
    input: '{"a":[1,2]}',
    expected: { a: [1, 2] },
  },
  { covers: 'format/1', source: '"a b" | format("uri")', expected: 'a%20b' },

  // Streaming: a stream event is [path, leaf], or [path] to close a container.
  {
    covers: 'tostream/0',
    source: '[tostream]',
    input: { a: [1] },
    expected: [[['a', 0], 1], [['a', 0]], [['a']]],
  },
  {
    covers: 'fromstream/1',
    source: 'fromstream({"a":1,"b":[2]} | tostream)',
    expected: { a: 1, b: [2] },
  },
  // The input is the number of path prefix elements to strip.
  {
    covers: 'truncate_stream/1',
    source: '[1 | truncate_stream({"a":[2,3]} | tostream)]',
    expected: [[[0], 2], [[1], 3], [[1]]],
  },

  // SQL-ish operators.
  {
    covers: 'INDEX/1',
    // jq's INDEX/1 delegates to INDEX/2, which the Excel library redefines as
    // positional lookup; resolving against core alone reaches jq's own.
    source: 'INDEX(.id)',
    input: [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ],
    libraries: ['core'],
    expected: { a: { id: 'a', n: 1 }, b: { id: 'b', n: 2 } },
  },
  { covers: 'IN/1', source: '2 | IN(1,2,3)', expected: true },
  { covers: 'IN/1', source: '9 | IN(1,2,3)', expected: false },
  { covers: 'IN/2', source: 'IN(1,2,3; 2)', expected: true },
  { covers: 'IN/2', source: 'IN(1,2,3; 9)', expected: false },
  {
    covers: 'JOIN/2',
    source: 'JOIN({"a":1}; .k)',
    input: [{ k: 'a' }],
    expected: [[{ k: 'a' }, 1]],
  },
  {
    covers: 'JOIN/3',
    source: 'JOIN({"a":1}; {"k":"a"}; .k)',
    expected: [{ k: 'a' }, 1],
  },
  {
    covers: 'JOIN/4',
    source: 'JOIN({"a":1}; {"k":"a"}; .k; .[1])',
    expected: 1,
  },

  // Dates. Every one of these is defined against UTC, so it must agree in
  // every zone; the two that read the host zone are further down.
  {
    covers: 'gmtime/0',
    source: '1425599507 | gmtime',
    expected: [2015, 2, 5, 23, 51, 47, 4, 63],
  },
  {
    covers: 'mktime/0',
    source: '[2015,2,5,23,51,47,4,63] | mktime',
    expected: 1425599507,
  },
  {
    covers: 'strftime/1',
    source: '1425599507 | strftime("%Y-%m-%dT%H:%M:%SZ")',
    expected: '2015-03-05T23:51:47Z',
  },
  {
    covers: 'strptime/1',
    source: '"2015-03-05T23:51:47Z" | strptime("%Y-%m-%dT%H:%M:%SZ")',
    expected: [2015, 2, 5, 23, 51, 47, 4, 63],
  },
  {
    covers: 'todate/0',
    source: '1425599507 | todate',
    expected: '2015-03-05T23:51:47Z',
  },
  {
    covers: 'todateiso8601/0',
    source: '86400 | todateiso8601',
    expected: '1970-01-02T00:00:00Z',
  },
  {
    covers: 'fromdate/0',
    source: '"2015-03-05T23:51:47Z" | fromdate',
    expected: 1425599507,
  },
  {
    covers: 'fromdateiso8601/0',
    source: '"1970-01-02T00:00:00Z" | fromdateiso8601',
    expected: 86400,
  },
  {
    covers: 'localtime/0',
    // Reading the host zone is the whole point of localtime, so the answer is
    // pinned to the epoch moved by exactly the offset that zone was on at the
    // epoch — which for several of them is not the offset they are on now:
    // Kathmandu ran +5:30 until 1986 and Kiritimati -10:40 until 1979. A
    // `gmtime` in disguise disagrees in every zone but UTC.
    source: '0 | localtime',
    check: (outputs, { offsetMinutes }) => {
      const epoch = new Date(0);
      deepStrictEqual(
        outputs[0],
        brokenDownTime(new Date(offsetMinutes(epoch) * 60_000)),
      );
    },
  },
  {
    covers: 'strflocaltime/1',
    // Same host-zone dependence as localtime, pinned the same way: the epoch
    // rendered at the zone's own wall clock, down to the minute, so a
    // `strftime` in disguise fails everywhere but UTC.
    source: '0 | strflocaltime("%Y-%m-%dT%H:%M:%S")',
    check: (outputs, { offsetMinutes }) => {
      const wallClock = new Date(offsetMinutes(new Date(0)) * 60_000);
      deepStrictEqual(outputs, [
        wallClock.toISOString().replace(/\.\d+Z$/, ''),
      ]);
    },
  },
  {
    covers: 'now/0',
    source: 'now',
    check: (outputs) => {
      const [seconds] = outputs as number[];
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
        throw new Error(
          `expected epoch seconds, got ${JSON.stringify(seconds)}`,
        );
      }
      // Seconds, not milliseconds: 2020 through 2100.
      if (seconds < 1577836800 || seconds > 4102444800) {
        throw new Error(
          `expected a plausible epoch-seconds reading, got ${seconds}`,
        );
      }
    },
  },

  // Failure and termination.
  { covers: 'error/0', source: '"boom" | error', throws: /boom/ },
  { covers: 'error/1', source: 'error("kaput")', throws: /kaput/ },
  { covers: 'halt/0', source: '1, halt, 2', outputs: [1] },
  { covers: 'halt_error/0', source: '"m" | halt_error', outputs: [] },
  { covers: 'halt_error/1', source: '"m" | halt_error(3)', outputs: [] },
  // Both write to the diagnostic channel and pass the input straight through.
  { covers: 'debug/0', source: '5 | debug', expected: 5 },
  { covers: 'debug/1', source: '3 | debug("note")', expected: 3 },
  { covers: 'stderr/0', source: '5 | stderr', expected: 5 },

  // The input stream and module loader jq builds on have no BXL equivalent:
  // one expression is evaluated against one value.
  {
    covers: 'input/0',
    source: 'input',
    throws: /Feature 'input\/0' is not implemented/,
  },
  {
    covers: 'inputs/0',
    // `inputs` is every remaining input, and a runtime whose inputs are
    // exhausted — as this one's always are — has none, so it yields an empty
    // stream where `input` raises.
    source: '[inputs]',
    expected: [],
  },
  {
    covers: 'input_filename/0',
    source: 'input_filename',
    throws: /Feature 'input_filename\/0' is not implemented/,
  },
  {
    covers: 'input_line_number/0',
    source: 'input_line_number',
    throws: /Feature 'input_line_number\/0' is not implemented/,
  },

  // Build configuration.
  {
    covers: 'builtins/0',
    // The list grows with each loaded library, so this pins its shape rather
    // than a count: sorted public names, no internal underscore-prefixed ones.
    source: 'builtins',
    check: (outputs) => {
      const [names] = outputs as string[][];
      if (!Array.isArray(names) || names.length === 0) {
        throw new Error(
          `expected a non-empty name list, got ${JSON.stringify(names)}`,
        );
      }
      if (
        !names.every(
          (name) => typeof name === 'string' && /^[^_].*\/\d+$/.test(name),
        )
      ) {
        throw new Error('expected every entry to be a public NAME/arity');
      }
      for (const name of ['length/0', 'map/1', 'builtins/0']) {
        if (!names.includes(name))
          throw new Error(`expected ${name} in the list`);
      }
      const sorted = [...names].sort();
      if (names.some((name, index) => name !== sorted[index])) {
        throw new Error('expected the list to be sorted');
      }
    },
  },
  { covers: 'get_search_list/0', source: 'get_search_list', expected: [] },
  {
    covers: 'get_jq_origin/0',
    source: 'get_jq_origin',
    expected: 'bxl://jq-origin',
  },
  {
    covers: 'get_prog_origin/0',
    source: 'get_prog_origin',
    expected: 'native-inline',
  },
  // Build-configuration constants, so one polarity is the whole answer:
  // BXL's numbers are IEEE doubles, with no decNumber and no preserved
  // literal text. Every other predicate in the suite is asserted both ways.
  { covers: 'have_decnum/0', source: 'have_decnum', expected: false },
  {
    covers: 'have_literal_numbers/0',
    source: 'have_literal_numbers',
    expected: false,
  },

  // Private helpers: callable, but kept out of what `builtins` reports —
  // jq hides its own the same way. Each is the worker a public definition
  // delegates to, so its own contract is worth pinning rather than leaving
  // to whatever the wrapper happens to exercise. See PRIVATE_BUILTINS in
  // ../gate.ts for why each one is unlisted.
  {
    covers: 'env/0',
    // The sandbox blocks it by name, which is the point: a card expression
    // must not be able to read the process environment.
    source: 'env',
    throws: /env is not available in the public BXL sandbox/,
  },
  // `_assign` and `_modify` are what jq's grammar desugars `=` and `|=` into.
  // BXL's evaluator applies both operators directly, so these run only when a
  // program names one — which a jq program ported from upstream may.
  {
    covers: '_assign/2',
    source: '_assign(.a, .b; 9)',
    input: { a: 1, b: 2 },
    expected: { a: 9, b: 9 },
  },
  {
    covers: '_modify/2',
    source: '_modify(.a, .b; . + 1)',
    input: { a: 1, b: 2 },
    expected: { a: 2, b: 3 },
  },
  // Likewise unary minus.
  { covers: '_negate/0', source: '_negate', input: 5, expected: -5 },
  // `_flatten` takes the remaining depth, so 1 flattens one level and leaves
  // the nesting below it alone.
  {
    covers: '_flatten/1',
    source: '_flatten(1)',
    input: [[1, [2]], [3]],
    expected: [1, [2], 3],
  },
  // The string half of `indices`: every start offset of the needle, counted
  // in code points.
  {
    covers: '_strindices/1',
    source: '_strindices("ab")',
    input: 'abcab',
    expected: [0, 3],
  },
  // `match`, `test` and `capture` all funnel here. The third argument is the
  // test flag: true reports only whether the regex matched.
  {
    covers: '_match_impl/3',
    source: '_match_impl("b(c)"; null; false)',
    input: 'abc',
    expected: [
      {
        offset: 1,
        length: 2,
        string: 'bc',
        captures: [{ offset: 2, length: 1, string: 'c', name: null }],
      },
    ],
  },
  {
    covers: '_match_impl/3',
    source: '_match_impl("z"; null; true)',
    input: 'abc',
    expected: false,
  },
  {
    covers: '_match_impl/3',
    source: '_match_impl("b"; null; true)',
    input: 'abc',
    expected: true,
  },
  // `_nwise` chunks a stream; the two-argument form takes the array to chunk
  // as its first argument rather than reading it from the input.
  {
    covers: '_nwise/2',
    source: '[_nwise([1, 2, 3, 4, 5]; 2)]',
    expected: [[1, 2], [3, 4], [5]],
  },
  {
    covers: '_nwise/1',
    source: '[_nwise(2)]',
    input: [1, 2, 3, 4, 5],
    expected: [[1, 2], [3, 4], [5]],
  },
  // The `_*_by_impl` family shares one protocol: the caller passes
  // `map([f])`, so the key expression is evaluated once per element and the
  // worker compares keys rather than whole items. A key array shorter than
  // the input would leave later elements keyless, which is why each case
  // uses a key that disagrees with the item's own ordering.
  {
    covers: '_sort_by_impl/1',
    source: '_sort_by_impl(map([-.n]))',
    input: [{ n: 1 }, { n: 3 }, { n: 2 }],
    expected: [{ n: 3 }, { n: 2 }, { n: 1 }],
  },
  {
    covers: '_group_by_impl/1',
    source: '_group_by_impl(map([.n % 2]))',
    input: [{ n: 1 }, { n: 2 }, { n: 3 }],
    expected: [[{ n: 2 }], [{ n: 1 }, { n: 3 }]],
  },
  {
    covers: '_min_by_impl/1',
    source: '_min_by_impl(map([-.n]))',
    input: [{ n: 1 }, { n: 3 }, { n: 2 }],
    expected: { n: 3 },
  },
  {
    covers: '_max_by_impl/1',
    source: '_max_by_impl(map([-.n]))',
    input: [{ n: 1 }, { n: 3 }, { n: 2 }],
    expected: { n: 1 },
  },
]);
