/-
Which spelling a query is read in, what each spelling refuses, and what an
accepted query means: `usesNewSyntax`, `assertAuthoredQuerySpelling` and
`assertQuery` (packages/runtime-common/query-syntax.ts, query.ts) on the
filter fragment.

A query in the older spelling (main's grammar) is read as it always was: a
member the grammar doesn't know is ignored inside a filter node or `page`,
since saved queries carry them, and refused at the top level, as main
refused it.
Writing any member Query V2 added makes the whole query the newer spelling,
read strictly: an unknown member is refused. An author's query in the newer
spelling that still names its type with an `on` on the top filter node is
refused as mixed spelling, with the rewrite to a top-level `type`.

The member lists are the grammar table's (query-grammar.ts), copied; the
conformance check holds the copies to the table. Unknown members are
modeled at the top level, in `page` and beside the top filter node's
operator; a member's value is not modeled.
-/
import QueryV2.Laws

namespace QueryV2

def topMarkers : List String :=
  ["facets", "collapse", "let", "explain", "timeZone", "type", "select"]
def pageMarkers : List String := ["total", "exactTotal"]
def filterMarkers : List String :=
  ["near", "pattern", "regex", "linkedFrom", "exists", "missing", "fields",
   "within", "prefix", "typos", "scope"]

/-- What `assertQuery` knows at the top level: the grammar's members but
the search-entry grammar's (`select`). -/
def topKnown : List String :=
  ["filter", "sort", "page", "facets", "collapse", "let", "explain", "rerank",
   "timeZone", "asData", "fields", "type", "realm", "realms", "queryString"]
def pageKnown : List String := ["size", "number", "generation", "exactTotal", "total"]
def filterModifiers : List String :=
  ["on", "type", "fields", "within", "prefix", "typos", "scope", "typoQuery",
   "typoPartial", "wordStatistics"]
/-- Modifiers that belong beside `matches` only, in either spelling. -/
def besideMatches : List String := ["fields", "within", "prefix", "typos", "scope"]

/-- A query as written. `nodeExtras` are the members beside the top filter
node's operator; `top` and `page` the members besides `type`, `filter`. -/
structure Written where
  type : Option String
  filter : Option Filter
  nodeExtras : List String
  top : List String
  page : List String

/-- A node only the newer spelling has: a bare `{ on }`, `exists`, `missing`. -/
def Filter.newerNode : Filter → Bool
  | .anchor _ | .exists _ | .missing _ => true
  | .on _ f | .not f => f.newerNode
  | .any fs | .every fs => (fs.map fun f => f.newerNode).or
  | _ => false

def Written.newer (w : Written) : Bool :=
  w.type.isSome || w.top.any topMarkers.contains || w.page.any pageMarkers.contains ||
    w.nodeExtras.any filterMarkers.contains || (w.filter.map Filter.newerNode).getD false

/-- The type named the older way: an `on` on the top filter node. -/
def Written.olderAnchor (w : Written) : Bool :=
  w.type.isNone && match w.filter with
    | some (.on _ _) => true
    | _ => false

def Written.unknownTop (w : Written) : Bool := w.top.any fun m => !topKnown.contains m

/-- A member the grammar doesn't know, where the older spelling ignores one. -/
def Written.unknown (w : Written) : Bool :=
  w.page.any (fun m => !pageKnown.contains m) ||
    w.nodeExtras.any (fun m => !filterModifiers.contains m)

/-- The refusals that apply, any of which may be the one raised. An
author's query (`authored`) is also held to the spelling check that runs
where it first arrives. -/
def Written.refusals (authored : Bool) (w : Written) : List String :=
  (if authored && w.newer && w.olderAnchor then ["mixed-spelling"] else []) ++
  (if w.unknownTop || (w.newer && w.unknown) then ["unknown-key"] else []) ++
  (if w.nodeExtras.any besideMatches.contains then ["conflicting-members"] else [])

def Written.meaning (w : Written) (c : Card) : Truth :=
  match w.type, w.filter with
  | none, none => .tt
  | some t, none => .ofBool (c.isA t)
  | some t, some f => eval c (lowerTyped t f)
  | none, some f => eval c f

/-! ### Laws -/

/-- Adding a member changes the spelling only by what that member is. -/
theorem newer_top_cons (w : Written) (n : String) :
    ({ w with top := n :: w.top } : Written).newer = (topMarkers.contains n || w.newer) := by
  simp only [Written.newer, List.any_cons]
  generalize w.type.isSome = a; generalize topMarkers.contains n = x
  generalize w.top.any topMarkers.contains = b; generalize w.page.any pageMarkers.contains = c
  generalize w.nodeExtras.any filterMarkers.contains = d
  generalize (w.filter.map Filter.newerNode).getD false = e
  cases a <;> cases x <;> cases b <;> cases c <;> cases d <;> cases e <;> rfl

theorem newer_page_cons (w : Written) (n : String) :
    ({ w with page := n :: w.page } : Written).newer = (pageMarkers.contains n || w.newer) := by
  simp only [Written.newer, List.any_cons]
  generalize w.type.isSome = a; generalize pageMarkers.contains n = x
  generalize w.top.any topMarkers.contains = b; generalize w.page.any pageMarkers.contains = c
  generalize w.nodeExtras.any filterMarkers.contains = d
  generalize (w.filter.map Filter.newerNode).getD false = e
  cases a <;> cases x <;> cases b <;> cases c <;> cases d <;> cases e <;> rfl

theorem newer_node_cons (w : Written) (n : String) :
    ({ w with nodeExtras := n :: w.nodeExtras } : Written).newer =
      (filterMarkers.contains n || w.newer) := by
  simp only [Written.newer, List.any_cons]
  generalize w.type.isSome = a; generalize filterMarkers.contains n = x
  generalize w.top.any topMarkers.contains = b; generalize w.page.any pageMarkers.contains = c
  generalize w.nodeExtras.any filterMarkers.contains = d
  generalize (w.filter.map Filter.newerNode).getD false = e
  cases a <;> cases x <;> cases b <;> cases c <;> cases d <;> cases e <;> rfl

theorem unknownTop_cons (w : Written) (n : String) :
    ({ w with top := n :: w.top } : Written).unknownTop = (!topKnown.contains n || w.unknownTop) := by
  simp only [Written.unknownTop, List.any_cons]

theorem unknown_node_cons (w : Written) (n : String) :
    ({ w with nodeExtras := n :: w.nodeExtras } : Written).unknown =
      (!filterModifiers.contains n || w.unknown) := by
  simp only [Written.unknown, List.any_cons]
  generalize w.page.any (fun m => !pageKnown.contains m) = b
  generalize (!filterModifiers.contains n) = x
  generalize w.nodeExtras.any (fun m => !filterModifiers.contains m) = d
  cases b <;> cases x <;> cases d <;> rfl

/-- Backward compatibility: in the older spelling a member the grammar
doesn't know changes nothing in `page` or beside the top filter node's
operator. A top-level member that is not a marker keeps the query in the
older spelling, and an unknown one is refused in either. -/
theorem older_stays_older_top (w : Written) (n : String)
    (hw : w.newer = false) (hn : topMarkers.contains n = false) :
    ({ w with top := n :: w.top } : Written).newer = false := by
  rw [newer_top_cons, hn, hw]; rfl

theorem older_ignores_page (a : Bool) (w : Written) (n : String)
    (hw : w.newer = false) (hn : pageMarkers.contains n = false) :
    let w' := { w with page := n :: w.page }
    w'.newer = false ∧ w'.refusals a = w.refusals a ∧ w'.meaning = w.meaning := by
  have h : ({ w with page := n :: w.page } : Written).newer = false := by
    rw [newer_page_cons, hn, hw]; rfl
  refine ⟨h, ?_, rfl⟩
  simp only [Written.refusals, Written.unknownTop, h, hw, Bool.and_false, Bool.false_and]

theorem besideMatches_markers (n : String) (h : filterMarkers.contains n = false) :
    besideMatches.contains n = false := by
  simp_all [filterMarkers, besideMatches]

theorem older_ignores_node (a : Bool) (w : Written) (n : String)
    (hw : w.newer = false) (hn : filterMarkers.contains n = false) :
    let w' := { w with nodeExtras := n :: w.nodeExtras }
    w'.newer = false ∧ w'.refusals a = w.refusals a ∧ w'.meaning = w.meaning := by
  have h : ({ w with nodeExtras := n :: w.nodeExtras } : Written).newer = false := by
    rw [newer_node_cons, hn, hw]; rfl
  refine ⟨h, ?_, rfl⟩
  simp only [Written.refusals, Written.unknownTop, h, hw, Bool.and_false, Bool.false_and, List.any_cons,
    besideMatches_markers n hn, Bool.false_or]

/-- Writing a member Query V2 added makes the query the newer spelling. -/
theorem marker_makes_newer (w : Written) (n : String) (hn : topMarkers.contains n = true) :
    ({ w with top := n :: w.top } : Written).newer = true := by
  rw [newer_top_cons, hn]; rfl

/-- An unknown top-level member is refused in either spelling. -/
theorem refuses_unknown_top (a : Bool) (w : Written) (n : String)
    (hn : topKnown.contains n = false) :
    "unknown-key" ∈ ({ w with top := n :: w.top } : Written).refusals a := by
  have u : ({ w with top := n :: w.top } : Written).unknownTop = true := by
    rw [unknownTop_cons, hn]; rfl
  simp [Written.refusals, u]

/-- The newer spelling is strict: a member it doesn't know is refused
wherever it is. -/
theorem newer_refuses_unknown_node (a : Bool) (w : Written) (n : String)
    (hw : w.newer = true) (hn : filterModifiers.contains n = false) :
    "unknown-key" ∈ ({ w with nodeExtras := n :: w.nodeExtras } : Written).refusals a := by
  have h : ({ w with nodeExtras := n :: w.nodeExtras } : Written).newer = true := by
    rw [newer_node_cons, hw, Bool.or_true]
  have u : ({ w with nodeExtras := n :: w.nodeExtras } : Written).unknown = true := by
    rw [unknown_node_cons, hn]; rfl
  simp [Written.refusals, h, u]

/-- The mixed-spelling refusal's rewrite is sound: putting the top node's
`on` at the top as `type` gives a query that is not refused as mixed, is
the newer spelling, and means what the older reading of the original meant. -/
theorem mixed_rewrite (w : Written) (t : String) (g : Filter)
    (hty : w.type = none) (hf : w.filter = some (.on t g)) :
    let w' := { w with type := some t, filter := some g }
    w'.olderAnchor = false ∧ w'.newer = true ∧ ∀ c, w'.meaning c = w.meaning c := by
  refine ⟨by simp [Written.olderAnchor], by simp [Written.newer], ?_⟩
  intro c
  simp only [Written.meaning, hty, hf]
  exact spellings_agree c t g

end QueryV2
