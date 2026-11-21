/-
The meaning of a Query V2 filter: for a card and a filter, the filter's truth.

This is the reference the evaluators are held to. Postgres is the reference
evaluator (docs/search.md, "Edge cases and what is guaranteed"), so where the
host's matcher and the SQL the engine emits could differ, this follows what
the SQL means.

What it covers: `eq` (with `null`), multi-key `eq`, `in` (with `null`),
`contains`, `range`, `exists`, `missing`, `not`, `any`, `every`, a type
(`type`), a type gate (`on`) and a bare `{ on }`, over scalar and list fields
of text and whole numbers. What it leaves out, each the server's alone:
`matches`, `near`, `pattern`, `regex`, `linkedFrom`, links, dates, `let`,
and everything past the filter (sort, facets, collapse, page).
-/
import QueryV2.Truth

namespace QueryV2

inductive Value where
  | str (s : String)
  | num (n : Int)
  deriving DecidableEq, Repr

/-- What a card holds at a field. An absent key and a JSON `null` read
alike: a scalar with no value. A list holds its elements, each a value or
`null`; an absent list is the empty list. -/
inductive Slot where
  | scalar (v : Option Value)
  | list (es : List (Option Value))
  deriving DecidableEq, Repr

/-- A card: the types it is an instance of (its own and its ancestors') and
what it holds at each field. -/
structure Card where
  types : List String
  slot : String → Slot

def Card.isA (c : Card) (t : String) : Bool := c.types.contains t

inductive RangeOp where
  | gt
  | gte
  | lt
  | lte
  deriving DecidableEq, Repr

inductive Filter where
  /-- `{ type: T }`: every card of `T` and its subtypes. -/
  | type (t : String)
  /-- `{ on: T }` and nothing else, the newer spelling of `{ type: T }`. -/
  | anchor (t : String)
  /-- `{ on: T, … }`: the node's test, for cards of `T`. -/
  | on (t : String) (f : Filter)
  /-- `{ eq: { p: v } }`; `none` is `eq: null`. -/
  | eq (p : String) (v : Option Value)
  /-- `{ eq: { p₁: v₁, p₂: v₂, … } }`, one object with several paths. -/
  | eqs (kvs : List (String × Option Value))
  | inn (p : String) (vs : List (Option Value))
  /-- `{ contains: { p: s } }`; `none` is `contains: null`. -/
  | contains (p : String) (s : Option String)
  | range (p : String) (bounds : List (RangeOp × Int))
  | «exists» (p : String)
  | missing (p : String)
  | not (f : Filter)
  | any (fs : List Filter)
  | every (fs : List Filter)
  deriving Repr, Inhabited

/-- Whether `n` occurs in `h`: `ILIKE '%n%'` with `n`'s `%` and `_` matched
as written. The fold is ASCII; the vectors use only ASCII text. -/
def occursIn : List Char → List Char → Bool
  | n, [] => n.isEmpty
  | n, h@(_ :: t) => n.isPrefixOf h || occursIn n t

def textContains (needle hay : String) : Bool :=
  occursIn needle.toLower.toList hay.toLower.toList

def RangeOp.holds : RangeOp → Int → Int → Bool
  | .gt, x, b => decide (x > b)
  | .gte, x, b => decide (x ≥ b)
  | .lt, x, b => decide (x < b)
  | .lte, x, b => decide (x ≤ b)

/-- A comparison with a value. A scalar with no value is `unknown`. A list
holds when some element does, so it is never `unknown`, and an empty list
fails. -/
def compare (pred : Value → Bool) : Slot → Truth
  | .scalar none => .unknown
  | .scalar (some w) => .ofBool (pred w)
  | .list es => .ofBool (es.any fun e => e.any pred)

/-- No value at the path: a scalar with none, or a list with no element that
has one. Plainly true or false. -/
def noValue : Slot → Truth
  | .scalar v => .ofBool v.isNone
  | .list es => .ofBool (es.all Option.isNone)

def eqLeaf (s : Slot) : Option Value → Truth
  | none => noValue s
  | some v => compare (· == v) s

def inLeaf (s : Slot) (vs : List (Option Value)) : Truth :=
  let vals := vs.filterMap id
  let hasNull := vs.contains none
  if vs.isEmpty then .ff
  else match s with
    | .scalar none => if hasNull then .tt else .unknown
    | .scalar (some w) => .ofBool (vals.contains w)
    | .list es =>
      .ofBool ((hasNull && (es.all Option.isNone)) ||
        es.any fun e => e.any vals.contains)

def containsLeaf (s : Slot) : Option String → Truth
  | none => noValue s
  | some n => compare (fun w => match w with
    | .str h => textContains n h
    | .num _ => false) s

/-- Every bound is met by one value together: on a list, by one element. -/
def rangeLeaf (s : Slot) (bounds : List (RangeOp × Int)) : Truth :=
  compare (fun w => match w with
    | .num x => bounds.all fun (op, b) => op.holds x b
    | .str _ => false) s

def eval (c : Card) : Filter → Truth
  | .type t => .ofBool (c.isA t)
  | .anchor t => .ofBool (c.isA t)
  | .on t f => if c.isA t then eval c f else .ff
  | .eq p v => eqLeaf (c.slot p) v
  | .eqs kvs => Truth.all (kvs.map fun kv => eqLeaf (c.slot kv.1) kv.2)
  | .inn p vs => inLeaf (c.slot p) vs
  | .contains p s => containsLeaf (c.slot p) s
  | .range p bs => rangeLeaf (c.slot p) bs
  | .exists p => (noValue (c.slot p)).not
  | .missing p => noValue (c.slot p)
  | .not f => (eval c f).not
  | .any fs => Truth.any (fs.map (eval c))
  | .every fs => Truth.all (fs.map (eval c))

/-- A row is in the answer when its filter is true. -/
def holds (c : Card) (f : Filter) : Prop := eval c f = .tt

/-! ### Refused filters

A filter can be well formed and still not be a question about its fields:
`contains` asks for text, and the server refuses it on a number field
(`InvalidQueryError`) rather than answer. `eval` answers every filter; the
answer to a refused one is never asked for. -/

inductive Kind where
  | text
  | number
  deriving DecidableEq, Repr

def refused (kind : String → Kind) : Filter → Bool
  | .contains p (some _) => kind p == .number
  | .on _ f | .not f => refused kind f
  | .any fs | .every fs => (fs.map fun f => refused kind f).or
  | _ => false

/-! ### Lowering

`lowerFilter` and the top of `lowerQueryInto` in
`packages/runtime-common/query-syntax.ts`, on this fragment. -/

/-- Each node, lowered: a bare `{ on }` is `{ type }`, `missing` is
`eq: null` and `exists` its `not`. -/
def lower : Filter → Filter
  | .anchor t => .type t
  | .exists p => .not (.eq p none)
  | .missing p => .eq p none
  | .on t f => .on t (lower f)
  | .not f => .not (lower f)
  | .any fs => .any (fs.map lower)
  | .every fs => .every (fs.map lower)
  | f => f

/-- A query whose top-level `type` is `T`: the lowered filter, answering to
`T`. A filter already gated on `T` stays as it is; a pure `every` keeps its
children; anything else is wrapped. -/
def lowerTyped (T : String) (f : Filter) : Filter :=
  match lower f with
  | .on s g => if s = T then .on s g else .on T (.every [.on s g])
  | .type s => if s = T then .type s else .on T (.every [.type s])
  | .every fs => .on T (.every fs)
  | g => .on T (.every [g])

/-- No node the engine would have to lower again. -/
def IsEngineForm : Filter → Prop
  | .anchor _ => False
  | .exists _ => False
  | .missing _ => False
  | .on _ f => IsEngineForm f
  | .not f => IsEngineForm f
  | .any fs => ∀ f ∈ fs, IsEngineForm f
  | .every fs => ∀ f ∈ fs, IsEngineForm f
  | _ => True

end QueryV2
