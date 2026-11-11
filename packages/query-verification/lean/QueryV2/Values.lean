/-
The typed-value vectors: boolean, decimal, big-integer, date and date-time
fields, and lists of decimals and date-times.

Every value is an integer in the model, so the filter laws hold for them
unchanged; only how a value is written differs by field. A decimal is in
hundredths, a big integer is itself, a date is days since 1970-01-01, a
date-time is minutes since 1970-01-01T00:00Z, and a boolean is 0 or 1.
Comparing two values compares the integers: a date-time bound means its
instant however it is spelled (with no zone it is UTC, `Z`, an offset), and
a number written as a string is that number (docs/search.md, "Relative
dates" and "Time zones").

Each card carries its search doc (`doc`, as an index running in UTC writes
it) and its card JSON (`attrs`, what an instance is read from). Cards of `C`
hold text under the same field names, for a query on `A` to pass over.
-/
import QueryV2

open QueryV2

namespace Values

/-! ### Calendar -/

def daysFromCivil (y m d : Int) : Int :=
  let y := if m ≤ 2 then y - 1 else y
  let era := y / 400
  let yoe := y - era * 400
  let mp := if m > 2 then m - 3 else m + 9
  let doy := (153 * mp + 2) / 5 + d - 1
  let doe := yoe * 365 + yoe / 4 - yoe / 100 + doy
  era * 146097 + doe - 719468

def civilFromDays (z : Int) : Int × Int × Int :=
  let z := z + 719468
  let era := z / 146097
  let doe := z - era * 146097
  let yoe := (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
  let doy := doe - (365 * yoe + yoe / 4 - yoe / 100)
  let mp := (5 * doy + 2) / 153
  let d := doy - (153 * mp + 2) / 5 + 1
  let m := if mp < 10 then mp + 3 else mp - 9
  (if m ≤ 2 then yoe + era * 400 + 1 else yoe + era * 400, m, d)

example : civilFromDays (daysFromCivil 2024 2 29) = (2024, 2, 29) := by decide
example : civilFromDays (daysFromCivil 1999 12 31) = (1999, 12, 31) := by decide
example : daysFromCivil 1970 1 1 = 0 := by decide

def pad (w : Nat) (n : Int) : String :=
  let t := toString n.natAbs
  "".pushn '0' (w - t.length) ++ t

def dayText (days : Int) : String :=
  let (y, m, d) := civilFromDays days
  s!"{pad 4 y}-{pad 2 m}-{pad 2 d}"

def minuteText (mins : Int) : String :=
  let days := mins / 1440
  let rest := mins - days * 1440
  s!"{dayText days}T{pad 2 (rest / 60)}:{pad 2 (rest % 60)}"

def day (y m d : Int) : Int := daysFromCivil y m d
def at_ (y m d hh mm : Int) : Int := daysFromCivil y m d * 1440 + hh * 60 + mm

/-! ### Field kinds and spellings -/

inductive Kind where
  | bool | dec | big | date | time
  deriving DecidableEq

/-- The field a path names. -/
def kindOf : String → Kind
  | "b" => .bool
  | "d" | "ds" => .dec
  | "g" => .big
  | "dy" => .date
  | _ => .time

def decText (minimal : Bool) (h : Int) : String :=
  let sign := if h < 0 then "-" else ""
  let a := h.natAbs
  let whole := a / 100
  let frac := a % 100
  if minimal then
    if frac == 0 then s!"{sign}{whole}"
    else if frac % 10 == 0 then s!"{sign}{whole}.{frac / 10}"
    else s!"{sign}{whole}.{frac}"
  else s!"{sign}{whole}.{pad 2 frac}"

/-- A value as the search doc and the card JSON hold it. -/
def stored (k : Kind) (v : Int) : J :=
  match k with
  | .bool => .bool (v != 0)
  | .dec => .lit (decText true v)
  | .big => .str (toString v)
  | .date => .str (dayText v)
  | .time => .str (minuteText v)

/-- A date-time in the card JSON, as `DatetimeField` serializes it. -/
def attr (k : Kind) (v : Int) : J :=
  match k with
  | .time => .str (minuteText v ++ ":00.000Z")
  | _ => stored k v

/-- How a query writes a value. `0` is the field's own spelling; the others
are spellings that mean the same value. -/
def spell (k : Kind) (sp : Nat) (v : Int) : J :=
  match k, sp with
  | .bool, 1 => .str (if v != 0 then "true" else "false")
  | .dec, 1 => .str (decText false v)
  | .big, 0 => if v.natAbs < 2 ^ 53 then .num v else .str (toString v)
  | .big, _ => .str (toString v)
  | .date, 1 => .str (dayText v ++ "T00:00:00Z")
  | .time, 1 => .str (minuteText v ++ ":00Z")
  | .time, 2 => .str (minuteText v ++ ":00.000Z")
  | .time, 3 => .str (minuteText (v + 330) ++ "+05:30")
  | .time, 4 => .str (dayText (v / 1440))
  | k, _ => stored k v

def spellOpt (p : String) (sp : Nat) : Option Value → J
  | none => .null
  | some (.num v) => spell (kindOf p) sp v
  | some (.str s) => .str s

partial def json (sp : Nat) : Filter → J
  | .type t => .obj [("type", typeRef t)]
  | .anchor t => .obj [("on", typeRef t)]
  | .on t f =>
    match json sp f with
    | .obj kvs =>
      if kvs.any (fun kv => kv.1 == "on" || kv.1 == "type") then
        .obj [("on", typeRef t), ("every", .arr [.obj kvs])]
      else .obj (("on", typeRef t) :: kvs)
    | other => .obj [("on", typeRef t), ("every", .arr [other])]
  | .eq p v => .obj [("eq", .obj [(p, spellOpt p sp v)])]
  | .eqs kvs => .obj [("eq", .obj (kvs.map fun (p, v) => (p, spellOpt p sp v)))]
  | .inn p vs => .obj [("in", .obj [(p, .arr (vs.map (spellOpt p sp)))])]
  | .contains p s => .obj [("contains", .obj [(p, match s with | none => .null | some s => .str s)])]
  | .range p bs => .obj [("range", .obj [(p, .obj (bs.map fun (op, b) => (op.key, spell (kindOf p) sp b)))])]
  | .exists p => .obj [("exists", .str p)]
  | .missing p => .obj [("missing", .str p)]
  | .not f => .obj [("not", json sp f)]
  | .any fs => .obj [("any", .arr (fs.map (json sp)))]
  | .every fs => .obj [("every", .arr (fs.map (json sp)))]

/-! ### Cards -/

inductive Raw where
  | absent
  | null
  | val (v : Int)
  | list (es : List (Option Int))

def scalars : List (String × List Raw) :=
  -- `BooleanField` reads an absent or null value as `false`
  [("b", [.val 1, .val 0]),
   ("d", [.absent, .null, .val (-250), .val 0, .val 50, .val 200, .val 1025]),
   ("g", [.absent, .null, .val (-5), .val 9, .val 10, .val 9007199254740993]),
   ("dy", [.absent, .null, .val (day 1999 12 31), .val (day 2000 1 1), .val (day 2024 2 29)]),
   ("ts", [.absent, .null, .val (at_ 1999 12 31 23 59), .val (at_ 2000 1 1 0 0),
     .val (at_ 2000 1 1 5 30)])]

def lists : List (String × List Raw) :=
  [("ds", [.absent, .list [], .list [none], .list [some 50], .list [some (-250), some 1025]]),
   ("tss", [.absent, .list [], .list [some (at_ 2000 1 1 0 0)],
     .list [some (at_ 1999 12 31 23 59), some (at_ 2000 1 1 5 30)]])]

def fields : List (String × Bool) :=
  (scalars.map fun (p, _) => (p, false)) ++ (lists.map fun (p, _) => (p, true))

def Raw.slot (list : Bool) : Raw → Slot
  | .absent | .null => if list then .list [] else .scalar none
  | .val v => .scalar (some (.num v))
  | .list es => .list (es.map (·.map .num))

def Raw.json? (f : Kind → Int → J) (k : Kind) : Raw → Option J
  | .absent => none
  | .null => some .null
  | .val v => some (f k v)
  | .list es => some (.arr (es.map fun e => (e.map (f k)).getD .null))

/-- Every combination of the date, date-time and list fields, each with one
of the combinations of the boolean, decimal and big-integer fields. -/
def raws : List (List Raw) := Id.run do
  let product (groups : List (List Raw)) : List (List Raw) :=
    groups.foldr (fun g acc => g.flatMap fun r => acc.map (r :: ·)) [[]]
  let first := product ((scalars.take 3).map (·.2))
  let second := product ((scalars.drop 3).map (·.2) ++ lists.map (·.2))
  return second.zipIdx.map fun (rs, i) => first[i % first.length]! ++ rs

structure Row where
  id : String
  type : String
  raws : List Raw

def Row.card (r : Row) : Card where
  types := [r.type]
  slot := fun p =>
    if r.type != "A" then .scalar none
    else match (fields.zip r.raws).find? (·.1.1 == p) with
      | some ((_, list), raw) => raw.slot list
      | none => .scalar none

def Row.json (r : Row) : J :=
  let side (f : Kind → Int → J) : J :=
    .obj ((fields.zip r.raws).filterMap fun ((p, _), raw) =>
      (raw.json? f (kindOf p)).map fun j => (p, j))
  .obj [("id", .str r.id), ("type", .str r.type), ("doc", side stored), ("attrs", side attr)]

/-- Text under every field name, as another type may hold it. -/
def textCards : List (String × List (String × J)) :=
  let all (s : String) := fields.map fun (p, list) => (p, if list then J.arr [.str s] else .str s)
  [("C-0", all "abc"), ("C-1", all ""), ("C-2", all "2000-01-01T00:00")]

def rows : List Row :=
  raws.zipIdx.map fun (rs, i) => { id := s!"A-{Values.pad 4 i}", type := "A", raws := rs }

/-! ### Cases -/

def v (x : Int) : Option Value := some (.num x)

def leaves : List (String × Nat × Filter) :=
  let midnight := at_ 2000 1 1 0 0
  let late := at_ 1999 12 31 23 59
  let morning := at_ 2000 1 1 5 30
  let big := 9007199254740993
  [("eq b true", 0, .eq "b" (v 1)), ("eq b false", 0, .eq "b" (v 0)),
   ("eq b \"true\"", 1, .eq "b" (v 1)), ("eq b \"false\"", 1, .eq "b" (v 0)),
   ("in b", 0, .inn "b" [v 1]), ("in b with null", 0, .inn "b" [v 0, none]),
   ("eq b null", 0, .eq "b" none),
   ("eq d", 0, .eq "d" (v 200)), ("eq d \"2.00\"", 1, .eq "d" (v 200)),
   ("eq d 0.5", 0, .eq "d" (v 50)), ("eq d \"0.50\"", 1, .eq "d" (v 50)),
   ("in d", 0, .inn "d" [v 50, v 1025]), ("in d strings", 1, .inn "d" [v 50, v 1025]),
   ("range d gt 0.5", 0, .range "d" [(.gt, 50)]), ("range d gt \"0.50\"", 1, .range "d" [(.gt, 50)]),
   ("range d gte 2", 0, .range "d" [(.gte, 200)]), ("range d lt 0", 0, .range "d" [(.lt, 0)]),
   ("range d lte -2.5", 0, .range "d" [(.lte, -250)]),
   ("range d between", 0, .range "d" [(.gt, 0), (.lt, 1025)]),
   ("range d between strings", 1, .range "d" [(.gt, 0), (.lt, 1025)]),
   ("eq g", 0, .eq "g" (v 10)), ("eq g \"10\"", 1, .eq "g" (v 10)),
   ("eq g big", 0, .eq "g" (v big)), ("in g", 0, .inn "g" [v 9, v 10]),
   ("in g strings", 1, .inn "g" [v 9, v 10]),
   ("range g gt 9", 0, .range "g" [(.gt, 9)]), ("range g gt \"9\"", 1, .range "g" [(.gt, 9)]),
   ("range g gte big", 0, .range "g" [(.gte, big)]),
   ("range g lt big", 0, .range "g" [(.lt, big)]),
   ("range g gt big - 1", 0, .range "g" [(.gt, big - 1)]),
   ("eq dy", 0, .eq "dy" (v (day 2000 1 1))),
   ("range dy gte", 0, .range "dy" [(.gte, day 2000 1 1)]),
   ("range dy lt", 0, .range "dy" [(.lt, day 2000 1 1)]),
   ("range dy lte leap day", 0, .range "dy" [(.lte, day 2024 2 29)]),
   ("range dy gte, as a date-time", 1, .range "dy" [(.gte, day 2000 1 1)]),
   ("eq dy, as a date-time", 1, .eq "dy" (v (day 2000 1 1)))] ++
  ([0, 1, 2, 3].flatMap fun sp =>
    let as := s!" (spelling {sp})"
    [(s!"eq ts" ++ as, sp, .eq "ts" (v midnight)),
     (s!"in ts" ++ as, sp, .inn "ts" [v midnight, v late]),
     (s!"range ts gte" ++ as, sp, .range "ts" [(.gte, midnight)]),
     (s!"range ts lt" ++ as, sp, .range "ts" [(.lt, morning)]),
     (s!"range ts gt late" ++ as, sp, .range "ts" [(.gt, late)]),
     (s!"range tss gte" ++ as, sp, .range "tss" [(.gte, midnight)]),
     (s!"eq tss" ++ as, sp, .eq "tss" (v morning))]) ++
  [("range ts gte, as a date", 4, .range "ts" [(.gte, midnight)]),
   ("range ts lt, as a date", 4, .range "ts" [(.lt, midnight)]),
   ("eq ds", 0, .eq "ds" (v 50)), ("eq ds \"0.50\"", 1, .eq "ds" (v 50)),
   ("range ds gt 0", 0, .range "ds" [(.gt, 0)]), ("range ds gt \"0.00\"", 1, .range "ds" [(.gt, 0)]),
   ("range ds between", 0, .range "ds" [(.gt, -300), (.lt, 0)])] ++
  (["b", "d", "g", "dy", "ts", "ds", "tss"].flatMap fun p =>
    [(s!"exists {p}", 0, Filter.exists p), (s!"missing {p}", 0, Filter.missing p)])

def compositions : List (String × Nat × Filter) :=
  [("a boolean or a decimal", 0, .any [.eq "b" (v 1), .range "d" [(.gt, 0)]]),
   ("a date and a date-time", 2, .every [.range "dy" [(.gte, day 2000 1 1)],
     .range "ts" [(.lt, at_ 2000 1 1 5 30)]]),
   ("not of a big integer and a list", 1, .not (.every [.range "g" [(.gt, 9)],
     .range "ds" [(.gt, 0)]]))]

def cases : List (String × Nat × Filter) :=
  leaves ++ leaves.map (fun (k, sp, f) => (s!"not {k}", sp, Filter.not f)) ++ compositions

def serializer : Kind → String
  | .bool => "boolean"
  | .dec => "number"
  | .big => "big-integer"
  | .date => "date"
  | .time => "datetime"

def main : IO Unit := do
  let rs := rows
  let cards := rs.map Row.card ++ textCards.map fun _ => ({ types := ["C"], slot := fun _ => .scalar none } : Card)
  let fieldJson (p : String) (list : Bool) (of : String) : String × J :=
    (p, .obj [("type", .str (if list then "containsMany" else "contains")), ("of", .str of)])
  let caseJson (name : String) (sp : Nat) (f : Filter) : J :=
    let lowered := lowerTyped "A" f
    let expect := String.ofList (cards.map fun c => match eval c lowered with
      | .tt => 't' | .ff => 'f' | .unknown => 'u')
    let older : List (String × J) :=
      match f with
      | .exists _ | .missing _ | .not (.exists _) | .not (.missing _) => []
      | _ => [("older", json sp (.on "A" f))]
    .obj ([("name", .str name),
      ("newer", .obj [("type", typeRef "A"), ("filter", json sp f)]),
      ("lowered", json sp lowered)] ++ older ++ [("expect", .str expect)])
  IO.println (J.obj [
    ("about", .str "Generated by packages/query-verification/lean (lake exe vectors values). Do not edit."),
    ("types", .obj [("A", .arr []), ("C", .arr [])]),
    ("fields", .obj (fields.map fun (p, list) => fieldJson p list (serializer (kindOf p)))),
    ("defs", .obj [("C", .obj [("kind", .str "card"),
      ("fields", .obj (fields.map fun (p, list) => fieldJson p list "string"))])]),
    ("cards", .arr (rs.map Row.json ++ textCards.map fun (id, doc) =>
      .obj [("id", .str id), ("type", .str "C"), ("doc", .obj doc)])),
    ("cases", .arr (cases.map fun (name, sp, f) => caseJson name sp f))]).render

end Values
