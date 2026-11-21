/-
Field paths: what a card holds at a dotted path (`m.r`, `ms.rs`, `au.nm`)
through compound fields and links.

A card's stored document nests a compound field's value, and a link's
target's values with its `id`, as JSON objects (its search doc). A path's
values are every leaf the path reaches: a list field on the way, or at the
end, fans out into its elements. A path that crosses a list field is a list
path: a filter on it holds when some value it reaches does, which is never
unknown; with no list on the way, the path holds one value or none.
-/
import QueryV2.Laws

namespace QueryV2

inductive Doc where
  | absent
  | null
  | str (s : String)
  | num (n : Int)
  | obj (kvs : List (String × Doc))
  | arr (ds : List Doc)
  deriving Inhabited, Repr

def Doc.get : Doc → String → Doc
  | .obj kvs, k => ((kvs.find? (·.1 == k)).map (·.2)).getD .absent
  | _, _ => .absent

def Doc.leaf : Doc → Option Value
  | .str s => some (.str s)
  | .num n => some (.num n)
  | _ => none

/-- The values a path reaches from `d`, given which field names are lists. -/
def Doc.reach (plural : String → Bool) : Doc → List String → List (Option Value)
  | d, [] => [d.leaf]
  | d, k :: rest =>
    if plural k then
      match d.get k with
      | .arr ds => ds.flatMap fun e => e.reach plural rest
      | _ => []
    else (d.get k).reach plural rest

def Doc.slot (plural : String → Bool) (d : Doc) (path : String) : Slot :=
  let segments := path.splitOn "."
  let values := d.reach plural segments
  if segments.any plural then .list values else .scalar (values.head?.getD none)

/-! ### Laws -/

/-- With no list on the way, a path reaches exactly one value (or none). -/
theorem reach_single (plural : String → Bool) :
    ∀ (path : List String) (d : Doc), path.any plural = false →
      (d.reach plural path).length = 1
  | [], _, _ => by simp [Doc.reach]
  | k :: rest, d, h => by
    simp only [List.any_cons, Bool.or_eq_false_iff] at h
    simp only [Doc.reach, h.1]
    exact reach_single plural rest (d.get k) h.2

/-- A filter on a path through a list holds when it holds of some element:
the list's elements are each a document the rest of the path is read from. -/
theorem compare_through_list (pred : Value → Bool) (plural : String → Bool)
    (ds : List Doc) (rest : List String) :
    compare pred (.list (ds.flatMap fun e => e.reach plural rest)) =
      .ofBool (ds.any fun e => (e.reach plural rest).any fun v => v.any pred) := by
  simp [compare, List.any_flatMap]

/-- An empty list on the way reaches nothing, so a comparison fails and its
`not` holds: an empty list is not a missing value. -/
theorem empty_on_the_way (pred : Value → Bool) (plural : String → Bool)
    (d : Doc) (k : String) (rest : List String) (hk : plural k = true)
    (hd : d.get k = .arr []) :
    compare pred (.list (d.reach plural (k :: rest))) = .ff := by
  simp [Doc.reach, hk, hd, compare, Truth.ofBool]

/-- Nothing is held below an absent value, so a path from it that crosses a
list reaches nothing. -/
theorem reach_absent (plural : String → Bool) :
    ∀ (path : List String), path.any plural = true →
      Doc.absent.reach plural path = []
  | [], h => by simp at h
  | k :: rest, h => by
    by_cases hk : plural k = true
    · simp [Doc.reach, hk, Doc.get]
    · simp only [List.any_cons, hk, Bool.false_or] at h
      simp only [Doc.reach, hk, Doc.get, Bool.false_eq_true, ite_false]
      exact reach_absent plural rest h

/-- A path through an absent or null compound into a list (`m.rs` with no
`m`) is still a list path: it reaches no element, so a comparison fails and
its `not` holds, as for an empty list. -/
theorem absent_before_list (pred : Value → Bool) (plural : String → Bool)
    (d : Doc) (k : String) (rest : List String) (hk : plural k = false)
    (hd : d.get k = .absent ∨ d.get k = .null) (hrest : rest.any plural = true) :
    compare pred (.list (d.reach plural (k :: rest))) = .ff := by
  have hnull : Doc.null.reach plural rest = Doc.absent.reach plural rest := by
    cases rest with
    | nil => simp at hrest
    | cons k' rest' => simp [Doc.reach, Doc.get]
  rcases hd with hd | hd <;>
    simp [Doc.reach, hk, hd, hnull, reach_absent plural rest hrest, compare,
      Truth.ofBool]

end QueryV2
