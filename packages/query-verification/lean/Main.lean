/-
Writes the conformance vectors: a bounded universe of cards, a family of
filters, and for each filter the truth `eval` gives on every card.

Each case carries the filter three ways: `newer` as an author writes it (a
top-level `type`), `lowered` as `lowerTyped` gives it (what the engine
receives), and, when the filter uses nothing the older spelling lacks,
`older` as a query saved in a realm writes it (`on` at the top).
`expect` holds one letter per card, in card order: `t`, `f` or `u`
(unknown).
-/
import QueryV2

open QueryV2

/-- What a card's JSON holds at a field: absent, `null`, or a value. -/
inductive Raw where
  | absent
  | null
  | val (v : Value)
  | list (es : List (Option Value))

def Raw.slot (list : Bool) : Raw → Slot
  | .absent => if list then .list [] else .scalar none
  | .null => if list then .list [] else .scalar none
  | .val v => .scalar (some v)
  | .list es => .list es

def Raw.json? : Raw → Option J
  | .absent => none
  | .null => some .null
  | .val v => some v.json
  | .list es => some (.arr (es.map optJson))

def s (x : String) : Option Value := some (.str x)
def n (x : Int) : Option Value := some (.num x)

def sRaws : List Raw := [.absent, .null, .val (.str "Red"), .val (.str "blue"), .val (.str "50%")]
def nRaws : List Raw := [.absent, .null, .val (.num 0), .val (.num 5), .val (.num 15)]
def ssRaws : List Raw := [.absent, .list [], .list [none], .list [s "red"],
  .list [s "red", s "blue"], .list [none, s "blue"]]
def nsRaws : List Raw := [.absent, .list [], .list [none], .list [n 5],
  .list [n 0, n 15], .list [none, n 5]]

def fieldKinds : List (String × Bool) := [("s", false), ("n", false), ("ss", true), ("ns", true)]

structure Row where
  id : String
  type : String
  types : List String
  raws : List Raw

def Row.card (r : Row) : Card where
  types := r.types
  slot := fun p =>
    match (fieldKinds.zip r.raws).find? (·.1.1 == p) with
    | some ((_, list), raw) => raw.slot list
    | none => .scalar none

def Row.json (r : Row) : J :=
  .obj [("id", .str r.id), ("type", .str r.type),
    ("doc", .obj ((fieldKinds.zip r.raws).filterMap fun ((p, _), raw) =>
      raw.json?.map fun j => (p, j)))]

def pad (k : Nat) : String :=
  let t := toString k
  "".pushn '0' (4 - t.length) ++ t

def docs : List (List Raw) := Id.run do
  let mut out := []
  for a in sRaws do
    for b in nRaws do
      for c in ssRaws do
        for d in nsRaws do
          out := out ++ [[a, b, c, d]]
  return out

/-- Every combination as a card of `A`; every thirtieth also as a card of
`Sub` (a subtype of `A`) and of `B` (another type). -/
def rows : List Row :=
  let all := docs.zipIdx
  let a := all.map fun (raws, i) => { id := s!"A-{pad i}", type := "A", types := ["A"], raws }
  let sub := (all.filter (·.2 % 30 == 7)).map fun (raws, i) =>
    { id := s!"Sub-{pad i}", type := "Sub", types := ["Sub", "A"], raws }
  let b := (all.filter (·.2 % 30 == 13)).map fun (raws, i) =>
    { id := s!"B-{pad i}", type := "B", types := ["B"], raws }
  a ++ sub ++ b

/-- Nothing the older spelling lacks. -/
def olderOnly : Filter → Bool
  | .anchor _ | .exists _ | .missing _ => false
  | .on _ f | .not f => olderOnly f
  | .any fs | .every fs => fs.attach.all fun ⟨f, _⟩ => olderOnly f
  | _ => true

def leaves : List (String × Filter) :=
  let eqs := [("s", [s "Red", s "red", s "blue", s "50%", s "zzz", none]),
    ("n", [n 0, n 5, n 15, n 7, none]),
    ("ss", [s "red", s "blue", s "Red", none]),
    ("ns", [n 5, n 0, n 15, n 7, none])]
  let ins := [("s", [[], [s "Red"], [s "Red", s "blue"], [none], [none, s "Red"]]),
    ("n", [[n 5], [n 0, n 15], [none], [none, n 5]]),
    ("ss", [[s "red"], [s "red", s "blue"], [none], [none, s "blue"]]),
    ("ns", [[n 5], [n 0, n 15], [none], [none, n 5]])]
  let contains := [("s", [some "re", some "ED", some "%", some "50%", some "", none]),
    ("ss", [some "re", some "LU", none]),
    ("n", [some "5", some "1"]),
    ("ns", [some "5"])]
  let ranges : List (List (RangeOp × Int)) :=
    [[(.gt, 0)], [(.gte, 5)], [(.lt, 5)], [(.lte, 15)], [(.gt, 0), (.lt, 15)]]
  (eqs.flatMap fun (p, vs) => vs.map fun v => (s!"eq {p}", Filter.eq p v)) ++
  (ins.flatMap fun (p, vss) => vss.map fun vs => (s!"in {p}", Filter.inn p vs)) ++
  (contains.flatMap fun (p, xs) => xs.map fun x => (s!"contains {p}", Filter.contains p x)) ++
  (["n", "ns"].flatMap fun p => ranges.map fun bs => (s!"range {p}", Filter.range p bs)) ++
  (["s", "n", "ss", "ns"].flatMap fun p =>
    [(s!"exists {p}", Filter.exists p), (s!"missing {p}", Filter.missing p)]) ++
  [("eq two paths", .eqs [("s", s "Red"), ("n", n 5)]),
   ("eq two paths, one null", .eqs [("s", s "Red"), ("n", none)])]

def listTests : List (String × Filter) :=
  [("two eq on one list", .every [.eq "ns" (n 0), .eq "ns" (n 15)]),
   ("two ranges on one list", .every [.range "ns" [(.gt, 10)], .range "ns" [(.lt, 5)]]),
   ("one range, both bounds, on a list", .range "ns" [(.gt, 0), (.lt, 15)]),
   ("not of two eq on one list", .not (.every [.eq "ss" (s "red"), .eq "ss" (s "blue")])),
   ("a list test or another field missing", .any [.eq "ss" (s "red"), .missing "s"])]

def gates : List (String × Filter) :=
  [("type Sub", .type "Sub"), ("bare on Sub", .anchor "Sub"), ("type B", .type "B"),
   ("on Sub", .on "Sub" (.eq "s" (s "Red"))),
   ("not on Sub", .not (.on "Sub" (.eq "s" (s "Red")))),
   ("on B", .on "B" (.eq "s" (s "Red"))),
   ("not type Sub", .not (.type "Sub"))]

/-- Every combination, two deep, of three leaves that between them are
true, false and unknown on the cards. -/
def compositions : List (String × Filter) :=
  let atoms : List Filter := [.eq "s" (s "Red"), .range "n" [(.gte, 5)], .eq "ss" (s "red")]
  let one : List Filter :=
    atoms.map .not ++
    (atoms.flatMap fun a => atoms.flatMap fun b => [.every [a, b], .any [a, b]])
  let two : List Filter :=
    one.map .not ++
    (one.flatMap fun a => atoms.flatMap fun b => [.every [a, b], .any [b, a]])
  (one ++ two).map fun f => ("composition", f)

def cases : List (String × Filter) :=
  (leaves ++ leaves.map fun (k, f) => (s!"not {k}", Filter.not f)) ++
  listTests ++ gates ++ compositions

def fieldKind (p : String) : Kind := if p.startsWith "n" then .number else .text

def truthChar : Truth → Char
  | .tt => 't'
  | .ff => 'f'
  | .unknown => 'u'

/-! ### The grammar vectors -/

/-- A value for a member, by its name: any value the member accepts. -/
def memberValue : String → J
  | "timeZone" => .str "UTC"
  | "explain" => .bool true
  | "total" => .str "exact"
  | "size" => .num 10
  | "prefix" => .bool true
  | _ => .str "unread"

def QueryV2.Written.json (w : Written) : J :=
  let filter := w.filter.map fun f =>
    match f.json with
    | .obj kvs => .obj (kvs ++ w.nodeExtras.map fun m => (m, memberValue m))
    | other => other
  .obj ((w.type.map fun t => [("type", typeRef t)]).getD [] ++
    (filter.map fun j => [("filter", j)]).getD [] ++
    w.top.map (fun m => (m, memberValue m)) ++
    (if w.page.isEmpty then [] else [("page", .obj (w.page.map fun m => (m, memberValue m)))]))

/-- Every combination of a type, a filter, and members that are the older
spelling's, the newer's, or neither's, at each place. -/
def writtenQueries : List Written := Id.run do
  let filters : List (Option Filter) :=
    [none, some (.eq "s" (s "Red")), some (.on "A" (.eq "s" (s "Red"))),
     some (.exists "s"), some (.anchor "Sub"), some (.on "Sub" (.eq "s" (s "Red"))),
     some (.not (.missing "n"))]
  let mut out := []
  for type in [none, some "A"] do
    for filter in filters do
      -- a node with nothing but `on` or `type` has no operator to sit beside
      let operatorNode := match filter with
        | some (.anchor _) | some (.type _) | none => false
        | _ => true
      for nodeExtras in (if operatorNode then [[], ["note"], ["prefix"]] else [[]]) do
        for top in [[], ["note"], ["timeZone"], ["explain", "note"]] do
          for page in [[], ["size"], ["size", "total"], ["size", "cursor"]] do
            out := out ++ [{ type, filter, nodeExtras, top, page }]
  return out

def codes (l : List String) : J := .arr (l.map .str)

def grammarMain (cards : List Card) : IO Unit := do
  let caseJson := writtenQueries.map fun w =>
    let server := w.refusals false
    J.obj ([("query", w.json),
      ("spelling", .str (if w.newer then "newer" else "older")),
      ("authored", codes (w.refusals true)),
      ("server", codes server)] ++
      (if server.isEmpty then
        [("expect", .str (String.ofList (cards.map fun c => truthChar (w.meaning c))))]
       else []))
  IO.println (J.obj [
    ("about", .str "Generated by packages/query-verification/lean (lake exe vectors grammar). Do not edit. Cards are filters.json's."),
    ("members", .obj [
      ("topMarkers", codes topMarkers), ("pageMarkers", codes pageMarkers),
      ("filterMarkers", codes filterMarkers), ("topKnown", codes topKnown),
      ("pageKnown", codes pageKnown), ("filterModifiers", codes filterModifiers)]),
    ("cases", .arr caseJson)]).render

/-- A field of the schema, as `{ type, of }`. -/
def fieldJson (type of : String) : J := .obj [("type", .str type), ("of", .str of)]

def caseJson (cards : List Card) (kind : String → Kind) (name : String) (f : Filter) : J :=
  let lowered := lowerTyped "A" f
  let expect := String.ofList (cards.map fun c => truthChar (eval c lowered))
  J.obj ([("name", .str name),
    ("newer", .obj [("type", typeRef "A"), ("filter", f.json)]),
    ("lowered", lowered.json)] ++
    (if olderOnly f then [("older", (Filter.on "A" f).json)] else []) ++
    (if refused kind f then [("refused", .bool true)]
     else [("expect", .str expect)]))

/-! ### The path vectors -/

partial def QueryV2.Doc.json? : Doc → Option J
  | .absent => none
  | .null => some .null
  | .str s => some (.str s)
  | .num n => some (.num n)
  | .obj kvs => some (.obj (kvs.filterMap fun (k, d) => (Doc.json? d).map fun j => (k, j)))
  | .arr ds => some (.arr (ds.filterMap Doc.json?))

/-- `m` and `ms` hold a compound `Meta { r, rs }`; `au` and `aus` link to
cards of `P { nm }`. -/
def pathFields : List (String × String × String) :=
  [("m", "contains", "Meta"), ("ms", "containsMany", "Meta"),
   ("au", "linksTo", "P"), ("aus", "linksToMany", "P")]

def pathPlural (k : String) : Bool := k == "ms" || k == "aus" || k == "rs"

def link (i : Nat) (nm : Option Doc) : Doc :=
  .obj ([("id", .str s!"http://query-verification-test/P/{i}")] ++
    (nm.map fun d => [("nm", d)]).getD [])

def mDocs : List Doc :=
  [.absent, .null, .obj [], .obj [("r", .str "x")], .obj [("r", .null), ("rs", .arr [])],
   .obj [("r", .str "y"), ("rs", .arr [.str "x"])], .obj [("rs", .arr [.null, .str "x"])]]
def msDocs : List Doc :=
  [.absent, .arr [], .arr [.null], .arr [.obj []], .arr [.obj [("r", .str "x")]],
   .arr [.obj [("r", .str "y")], .obj [("r", .str "x"), ("rs", .arr [.str "y"])]]]
def auDocs : List Doc :=
  [.absent, .null, link 1 (some (.str "x")), link 2 (some .null), link 3 none]
def ausDocs : List Doc :=
  [.absent, .arr [], .arr [link 1 (some (.str "x"))],
   .arr [link 4 (some (.str "y")), link 1 (some (.str "x"))], .arr [link 3 none]]

def pathDocs : List Doc := Id.run do
  let mut out := []
  for m in mDocs do
    for ms in msDocs do
      for au in auDocs do
        for aus in ausDocs do
          out := out ++ [Doc.obj [("m", m), ("ms", ms), ("au", au), ("aus", aus)]]
  return out

def pathCases : List (String × Filter) :=
  let paths := ["m.r", "m.rs", "ms.r", "ms.rs", "au.nm", "aus.nm"]
  let leaves := paths.flatMap fun p =>
    [(s!"eq {p}", Filter.eq p (s "x")), (s!"eq {p} null", Filter.eq p none),
     (s!"in {p}", Filter.inn p [s "x"]), (s!"in {p} with null", Filter.inn p [none, s "y"]),
     (s!"contains {p}", Filter.contains p (some "X")),
     (s!"exists {p}", Filter.exists p), (s!"missing {p}", Filter.missing p)]
  let both : List (String × Filter) :=
    [("one compound, one list of them", .every [.eq "m.r" (s "x"), .eq "ms.r" (s "x")]),
     ("a link or a list of links", .any [.eq "au.nm" (s "x"), .eq "aus.nm" (s "y")]),
     ("two tests on one list of compounds", .every [.eq "ms.r" (s "x"), .eq "ms.rs" (s "y")]),
     ("not of two tests on one list of links", .not (.every [.eq "aus.nm" (s "x"), .eq "aus.nm" (s "y")]))]
  leaves ++ leaves.map (fun (k, f) => (s!"not {k}", Filter.not f)) ++ both

def pathsMain : IO Unit := do
  let docs := pathDocs.zipIdx
  let cards := docs.map fun (d, _) => ({ types := ["A"], slot := d.slot pathPlural } : Card)
  IO.println (J.obj [
    ("about", .str "Generated by packages/query-verification/lean (lake exe vectors paths). Do not edit."),
    ("types", .obj [("A", .arr [])]),
    ("fields", .obj (pathFields.map fun (k, t, o) => (k, fieldJson t o))),
    ("defs", .obj [
      ("Meta", .obj [("kind", .str "field"), ("fields", .obj [
        ("r", fieldJson "contains" "string"), ("rs", fieldJson "containsMany" "string")])]),
      ("P", .obj [("kind", .str "card"), ("fields", .obj [("nm", fieldJson "contains" "string")])])]),
    ("cards", .arr (docs.map fun (d, i) =>
      .obj [("id", .str s!"A-{pad i}"), ("type", .str "A"), ("doc", (d.json?).getD (.obj []))])),
    ("cases", .arr (pathCases.map fun (name, f) => caseJson cards (fun _ => .text) name f))]).render

def main (args : List String) : IO Unit := do
  let rs := rows
  let cards := rs.map Row.card
  if args == ["grammar"] then
    grammarMain cards
    return
  if args == ["paths"] then
    pathsMain
    return
  let out := J.obj [
    ("about", .str "Generated by packages/query-verification/lean (lake exe vectors). Do not edit."),
    ("types", .obj [("A", .arr []), ("Sub", .arr [.str "A"]), ("B", .arr [])]),
    ("fields", .obj (fieldKinds.map fun (p, list) =>
      (p, fieldJson (if list then "containsMany" else "contains")
        (if fieldKind p == .number then "number" else "string")))),
    ("defs", .obj []),
    ("cards", .arr (rs.map Row.json)),
    ("cases", .arr (cases.map fun (name, f) => caseJson cards fieldKind name f))]
  IO.println out.render
