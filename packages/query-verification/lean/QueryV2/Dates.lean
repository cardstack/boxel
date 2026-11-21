/-
The relative-date vectors: `range`, `eq` and `in` with `now`, `now-1d/d`,
`now/M` and the like, read against one fixed clock, over the typed-value
cards.

A relative date names an instant: the clock, moved by whole units (`s`, `m`
and `h` as elapsed time; `d`, `w`, `M` and `y` on the query's calendar) and
then rounded down to the start of a unit on that calendar, a week starting
on Monday. It is compared in the field's own format (docs/search.md,
"Relative dates"): on a date field the day it falls on in the query's zone,
on a date-time field its UTC minute. The zones here, UTC and New York in
winter, have fixed offsets over every instant the cases reach.

On a date or date-time field a string that starts like a relative date but
is not one is refused; on any other field it is text, so the cards of `C`,
which hold text under the same field names, match it as written.
-/
import QueryV2
import QueryV2.Values

open QueryV2

namespace Dates

open Values (day at_ dayText minuteText kindOf)

/-- The clock every case reads, in seconds since 1970-01-01T00:00Z: thirty
seconds into the minute a stored date-time holds. -/
def nowSec : Int := day 2000 1 1 * 86400 + 30

def nowText : String := "2000-01-01T00:00:30.000Z"

inductive U where
  | s | m | h | d | w | M | y

def U.text : U → String
  | .s => "s" | .m => "m" | .h => "h" | .d => "d" | .w => "w" | .M => "M" | .y => "y"

structure Rel where
  move : Option (Int × U) := none
  round : Option U := none

def Rel.text (r : Rel) : String :=
  "now" ++
  (match r.move with
   | some (n, u) => (if n < 0 then "-" else "+") ++ toString n.natAbs ++ u.text
   | none => "") ++
  (match r.round with
   | some u => "/" ++ u.text
   | none => "")

/-- Minutes east of UTC. -/
def offsetOf : Option String → Int
  | some "America/New_York" => -300
  | _ => 0

def moveMonths (wall : Int) (n : Int) : Int :=
  let days := wall / 86400
  let rest := wall - days * 86400
  let (y, m, d) := Values.civilFromDays days
  let total := y * 12 + (m - 1) + n
  Values.daysFromCivil (total / 12) (total % 12 + 1) d * 86400 + rest

/-- The instant a relative date names, in seconds, reckoned on the calendar
of a zone `off` minutes east of UTC. -/
def resolve (off : Int) (r : Rel) : Int :=
  let wall := nowSec + off * 60
  let wall := match r.move with
    | none => wall
    | some (n, .s) => wall + n
    | some (n, .m) => wall + n * 60
    | some (n, .h) => wall + n * 3600
    | some (n, .d) => wall + n * 86400
    | some (n, .w) => wall + n * 7 * 86400
    | some (n, .M) => moveMonths wall n
    | some (n, .y) => moveMonths wall (12 * n)
  let civil := Values.civilFromDays (wall / 86400)
  let wall := match r.round with
    | none | some .s => wall
    | some .m => wall - wall % 60
    | some .h => wall - wall % 3600
    | some .d => wall - wall % 86400
    | some .w =>
      let days := wall / 86400
      (days - (days + 3) % 7) * 86400
    | some .M => Values.daysFromCivil civil.1 civil.2.1 1 * 86400
    | some .y => Values.daysFromCivil civil.1 1 1 * 86400
  wall - off * 60

/-- A relative date in the format of a field of kind `k`. -/
def inField (k : Values.Kind) (off : Int) (r : Rel) : Int :=
  let i := resolve off r
  match k with
  | .date => (i + off * 60) / 86400
  | _ => i / 60

def text (k : Values.Kind) (x : Int) : String :=
  match k with
  | .date => dayText x
  | _ => minuteText x

example : inField .date 0 { round := some .d } = day 2000 1 1 := by decide
example : inField .date (-300) { round := some .d } = day 1999 12 31 := by decide
example : inField .time 0 {} = at_ 2000 1 1 0 0 := by decide
example : inField .time (-300) { round := some .h } = at_ 2000 1 1 0 0 := by decide
example : inField .date 0 { round := some .w } = day 1999 12 27 := by decide
example : inField .date 0 { move := some (24, .y), round := some .M } = day 2024 1 1 := by decide

/-! ### Cases -/

structure Case where
  name : String
  type : String := "A"
  zone : Option String := none
  filter : Filter
  /-- Each value the filter's JSON writes in the field's format, and the
  text the query writes in its place. -/
  subs : List (String × String) := []
  refused : Bool := false

partial def subst (subs : List (String × String)) : J → J
  | .str s => .str ((subs.find? (·.1 == s)).map (·.2) |>.getD s)
  | .arr xs => .arr (xs.map (subst subs))
  | .obj kvs => .obj (kvs.map fun (k, v) => (k, subst subs v))
  | j => j

def num (x : Int) : Option Value := some (.num x)

def zoneName : Option String → String
  | some _ => " (New York)"
  | none => ""

def range (p : String) (bs : List (RangeOp × Rel)) (zone : Option String := none) : Case :=
  let k := kindOf p
  let off := offsetOf zone
  let name := s!"range {p} " ++ " ".intercalate (bs.map fun (op, r) => s!"{op.key} {r.text}") ++
    zoneName zone
  { name, zone,
    filter := .range p (bs.map fun (op, r) => (op, inField k off r)),
    subs := bs.map fun (_, r) => (text k (inField k off r), r.text) }

def eqRel (p : String) (r : Rel) (zone : Option String := none) : Case :=
  let k := kindOf p
  let off := offsetOf zone
  { name := s!"eq {p} {r.text}" ++ zoneName zone, zone,
    filter := .eq p (num (inField k off r)),
    subs := [(text k (inField k off r), r.text)] }

def inRel (p : String) (rs : List Rel) : Case :=
  let k := kindOf p
  { name := s!"in {p} " ++ ", ".intercalate (rs.map Rel.text),
    filter := .inn p (rs.map fun r => num (inField k 0 r)),
    subs := rs.map fun r => (text k (inField k 0 r), r.text) }

/-- A malformed relative date on a date field: refused. The filter stands a
day or minute in for it that no other value in the case is written as. -/
def malformed (name : String) (p : String) (bad : String) (f : Int → Filter) : Case :=
  let k := kindOf p
  let stand := match k with | .date => day 1970 1 2 | _ => at_ 1970 1 2 0 0
  { name := s!"{name} {bad}", filter := f stand, subs := [(text k stand, bad)], refused := true }

def leaves : List Case :=
  let d : Rel := { round := some .d }
  let ny := some "America/New_York"
  [range "dy" [(.gte, d)], range "dy" [(.lt, d)],
   range "dy" [(.gte, { move := some (-1, .d), round := some .d })],
   range "dy" [(.gt, { move := some (-1, .h) })],
   range "dy" [(.lte, {})],
   range "dy" [(.gte, { round := some .w })],
   range "dy" [(.lt, { move := some (1, .w), round := some .w })],
   range "dy" [(.gte, { move := some (-1, .y), round := some .y })],
   range "dy" [(.gte, { move := some (24, .y), round := some .M })],
   range "dy" [(.gte, { move := some (-1, .d), round := some .d }), (.lt, { move := some (1, .d), round := some .d })],
   eqRel "dy" d,
   inRel "dy" [d, { move := some (-1, .d), round := some .d }],
   range "ts" [(.gte, {})], range "ts" [(.lt, {})],
   range "ts" [(.gt, { move := some (-1, .m) })],
   range "ts" [(.lt, { move := some (5, .h), round := some .h })],
   range "ts" [(.gte, d)],
   range "ts" [(.gte, { move := some (-1, .d), round := some .d })],
   eqRel "ts" { round := some .m },
   range "tss" [(.gte, {})],
   range "dy" [(.gte, d)] ny, range "dy" [(.lt, d)] ny, range "dy" [(.gte, {})] ny,
   range "ts" [(.gte, d)] ny, range "ts" [(.gte, { round := some .h })] ny,
   eqRel "dy" d ny]

def text_ (x : String) : Option Value := some (.str x)

/-- Strings that start like a relative date: on a date field refused or
read as one, on a text field the text as written. -/
def literal : List Case :=
  [malformed "range dy gte" "dy" "now-3x" fun x => .range "dy" [(.gte, x)],
   malformed "eq ts" "ts" "NOW" fun x => .eq "ts" (num x),
   malformed "in dy" "dy" "now-1" fun x => .inn "dy" [num x],
   malformed "range ts lt" "ts" "now/q" fun x => .range "ts" [(.lt, x)],
   { name := "eq on text, now", type := "C", filter := .eq "dy" (text_ "now") },
   { name := "eq on text, now-3x", type := "C", filter := .eq "ts" (text_ "now-3x") },
   { name := "in on text", type := "C", filter := .inn "dy" [text_ "now", text_ "abc"] }]

def cases : List Case :=
  leaves ++ leaves.map (fun c => { c with name := s!"not {c.name}", filter := .not c.filter }) ++
  literal ++ literal.map (fun c => { c with name := s!"not {c.name}", filter := .not c.filter })

/-! ### Cards -/

def textCards : List (String × String) := [("C-0", "now"), ("C-1", "now-3x"), ("C-2", "abc")]

def textCard (s : String) : Card where
  types := ["C"]
  slot := fun p =>
    match Values.fields.find? (·.1 == p) with
    | some (_, true) => .list [some (.str s)]
    | some (_, false) => .scalar (some (.str s))
    | none => .scalar none

def textDoc (s : String) : J :=
  .obj (Values.fields.map fun (p, list) => (p, if list then J.arr [.str s] else .str s))

def main : IO Unit := do
  let rs := Values.rows
  let cards := rs.map Values.Row.card ++ textCards.map (textCard ·.2)
  let caseJson (c : Case) : J :=
    let lowered := lowerTyped c.type c.filter
    let fix := subst c.subs
    .obj ([("name", .str c.name)] ++
      (c.zone.map fun z => [("timeZone", .str z)]).getD [] ++
      [("newer", .obj [("type", typeRef c.type), ("filter", fix (Values.json 0 c.filter))]),
       ("lowered", fix (Values.json 0 lowered)),
       ("older", fix (Values.json 0 (.on c.type c.filter)))] ++
      (if c.refused then [("refused", .bool true)]
       else [("expect", .str (String.ofList (cards.map fun card =>
         match eval card lowered with | .tt => 't' | .ff => 'f' | .unknown => 'u')))]))
  let fieldJson (p : String) (list : Bool) (of : String) : String × J :=
    (p, .obj [("type", .str (if list then "containsMany" else "contains")), ("of", .str of)])
  IO.println (J.obj [
    ("about", .str "Generated by packages/query-verification/lean (lake exe vectors dates). Do not edit."),
    ("now", .str nowText),
    ("types", .obj [("A", .arr []), ("C", .arr [])]),
    ("fields", .obj (Values.fields.map fun (p, list) => fieldJson p list (Values.serializer (kindOf p)))),
    ("defs", .obj [("C", .obj [("kind", .str "card"),
      ("fields", .obj (Values.fields.map fun (p, list) => fieldJson p list "string"))])]),
    ("cards", .arr (rs.map Values.Row.json ++ textCards.map fun (id, s) =>
      .obj [("id", .str id), ("type", .str "C"), ("doc", textDoc s)])),
    ("cases", .arr (cases.map caseJson))]).render

end Dates
