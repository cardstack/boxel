/-
What holds of every filter, proved over `eval`.

Each theorem names the guarantee it pins, by its decision number in the
Query V2 specs (spec 00 "Overview and evaluation guarantees", spec 01
"Language and compatibility").
-/
import QueryV2.Filter

namespace QueryV2
open Truth

/-! ### Three-valued logic -/

@[simp] theorem not_not (x : Truth) : x.not.not = x := by
  cases x <;> rfl

/-- `every` is SQL's AND chain. -/
theorem all_cons (x : Truth) (l : List Truth) :
    Truth.all (x :: l) = Truth.and x (Truth.all l) := by
  unfold Truth.all
  cases x <;> by_cases h1 : Truth.ff ∈ l <;> by_cases h2 : Truth.unknown ∈ l <;>
    simp [h1, h2, Truth.and]

/-- `any` is SQL's OR chain. -/
theorem any_cons (x : Truth) (l : List Truth) :
    Truth.any (x :: l) = Truth.or x (Truth.any l) := by
  unfold Truth.any
  cases x <;> by_cases h1 : Truth.tt ∈ l <;> by_cases h2 : Truth.unknown ∈ l <;>
    simp [h1, h2, Truth.or]

theorem all_congr {l₁ l₂ : List Truth} (h : ∀ x, x ∈ l₁ ↔ x ∈ l₂) :
    Truth.all l₁ = Truth.all l₂ := by
  simp [Truth.all, h]

theorem any_congr {l₁ l₂ : List Truth} (h : ∀ x, x ∈ l₁ ↔ x ∈ l₂) :
    Truth.any l₁ = Truth.any l₂ := by
  simp [Truth.any, h]

theorem mem_map_not (l : List Truth) (x : Truth) :
    x ∈ l.map Truth.not ↔ x.not ∈ l := by
  simp only [List.mem_map]
  constructor
  · rintro ⟨a, ha, rfl⟩
    simpa using ha
  · intro h
    exact ⟨x.not, h, not_not x⟩

/-- De Morgan: `not` of `any` is `every` of the `not`s. -/
theorem not_any (l : List Truth) :
    (Truth.any l).not = Truth.all (l.map Truth.not) := by
  simp only [Truth.any, Truth.all, mem_map_not]
  by_cases h1 : Truth.tt ∈ l <;> by_cases h2 : Truth.unknown ∈ l <;>
    simp [h1, h2, Truth.not]

theorem not_all (l : List Truth) :
    (Truth.all l).not = Truth.any (l.map Truth.not) := by
  simp only [Truth.any, Truth.all, mem_map_not]
  by_cases h1 : Truth.ff ∈ l <;> by_cases h2 : Truth.unknown ∈ l <;>
    simp [h1, h2, Truth.not]

/-! ### Sets are sets (QV-D1)

The answer depends on which children `every` and `any` hold and which
values `in` holds, never on their order or on a repeat. -/

theorem every_congr (c : Card) {fs gs : List Filter}
    (h : ∀ f, f ∈ fs ↔ f ∈ gs) :
    eval c (.every fs) = eval c (.every gs) := by
  simp only [eval]
  apply all_congr
  intro x
  simp only [List.mem_map]
  constructor <;> rintro ⟨f, hf, rfl⟩
  · exact ⟨f, (h f).1 hf, rfl⟩
  · exact ⟨f, (h f).2 hf, rfl⟩

theorem any_congr_filters (c : Card) {fs gs : List Filter}
    (h : ∀ f, f ∈ fs ↔ f ∈ gs) :
    eval c (.any fs) = eval c (.any gs) := by
  simp only [eval]
  apply any_congr
  intro x
  simp only [List.mem_map]
  constructor <;> rintro ⟨f, hf, rfl⟩
  · exact ⟨f, (h f).1 hf, rfl⟩
  · exact ⟨f, (h f).2 hf, rfl⟩

theorem every_perm (c : Card) {fs gs : List Filter} (h : fs.Perm gs) :
    eval c (.every fs) = eval c (.every gs) :=
  every_congr c fun _ => h.mem_iff

theorem any_perm (c : Card) {fs gs : List Filter} (h : fs.Perm gs) :
    eval c (.any fs) = eval c (.any gs) :=
  any_congr_filters c fun _ => h.mem_iff

theorem every_dup (c : Card) (f : Filter) (fs : List Filter) :
    eval c (.every (f :: f :: fs)) = eval c (.every (f :: fs)) :=
  every_congr c fun g => by simp

theorem every_single (c : Card) (f : Filter) :
    eval c (.every [f]) = eval c f := by
  simp only [eval, List.map]
  rw [all_cons]
  cases eval c f <;> rfl

theorem in_congr (c : Card) (p : String) {vs ws : List (Option Value)}
    (h : ∀ v, v ∈ vs ↔ v ∈ ws) :
    eval c (.inn p vs) = eval c (.inn p ws) := by
  have hempty : vs.isEmpty = ws.isEmpty := by
    cases vs with
    | nil =>
      cases ws with
      | nil => rfl
      | cons w _ => exact absurd ((h w).2 (by simp)) (by simp)
    | cons v _ =>
      cases ws with
      | nil => exact absurd ((h v).1 (by simp)) (by simp)
      | cons _ _ => rfl
  have hnull : vs.contains none = ws.contains none := by
    simp [h]
  have hvals : (vs.filterMap id).contains = (ws.filterMap id).contains := by
    funext w
    simp [List.mem_filterMap, h]
  simp only [eval, inLeaf]
  rw [hempty, hnull, hvals]

/-! ### A missing value follows SQL (QV-D7)

A card with no value at a scalar path is returned by neither a comparison
with a value nor its `not`. -/

/-- The leaves that compare a path with a value. -/
inductive ComparesValue : Filter → String → Prop where
  | eq (p : String) (v : Value) : ComparesValue (.eq p (some v)) p
  | contains (p : String) (s : String) : ComparesValue (.contains p (some s)) p
  | range (p : String) (bs : List (RangeOp × Int)) : ComparesValue (.range p bs) p
  | inn (p : String) (vs : List (Option Value)) (hne : vs ≠ [])
      (hnn : none ∉ vs) : ComparesValue (.inn p vs) p

theorem missing_is_unknown (c : Card) {f : Filter} {p : String}
    (hf : ComparesValue f p) (hs : c.slot p = .scalar none) :
    eval c f = .unknown := by
  cases hf with
  | eq => simp [eval, eqLeaf, compare, hs]
  | contains => simp [eval, containsLeaf, compare, hs]
  | range => simp [eval, rangeLeaf, compare, hs]
  | inn _ vs hne hnn =>
    have : vs.isEmpty = false := by cases vs <;> simp_all
    simp [eval, inLeaf, hs, this, hnn]

theorem missing_excluded (c : Card) {f : Filter} {p : String}
    (hf : ComparesValue f p) (hs : c.slot p = .scalar none) :
    ¬ holds c f ∧ ¬ holds c (.not f) := by
  have hu := missing_is_unknown c hf hs
  simp [holds, eval, hu, Truth.not]

/-! ### Lists (QV-D8)

A list field matches when some element does, so a comparison on a list is
never unknown, and `not` keeps a card with an empty list. -/

theorem list_two_valued (c : Card) {f : Filter} {p : String}
    (hf : ComparesValue f p) {es : List (Option Value)} (hs : c.slot p = .list es) :
    eval c f ≠ .unknown := by
  cases hf with
  | eq => simp [eval, eqLeaf, compare, hs]; cases (es.any _) <;> simp [Truth.ofBool]
  | contains => simp [eval, containsLeaf, compare, hs]; cases (es.any _) <;> simp [Truth.ofBool]
  | range => simp [eval, rangeLeaf, compare, hs]; cases (es.any _) <;> simp [Truth.ofBool]
  | inn _ vs hne _ =>
    have : vs.isEmpty = false := by cases vs <;> simp_all
    simp only [eval, inLeaf, hs, this]
    cases (_ || _) <;> simp [Truth.ofBool]

theorem empty_list_not (c : Card) {f : Filter} {p : String}
    (hf : ComparesValue f p) (hs : c.slot p = .list []) :
    holds c (.not f) := by
  cases hf with
  | eq => simp [holds, eval, eqLeaf, compare, hs, Truth.ofBool, Truth.not]
  | contains => simp [holds, eval, containsLeaf, compare, hs, Truth.ofBool, Truth.not]
  | range => simp [holds, eval, rangeLeaf, compare, hs, Truth.ofBool, Truth.not]
  | inn _ vs hne hnn =>
    have : vs.isEmpty = false := by cases vs <;> simp_all
    simp [holds, eval, inLeaf, hs, this, hnn, Truth.ofBool, Truth.not]

/-- `exists` and `missing` are plainly true or false, and each is the
other's `not`. -/
theorem exists_not_missing (c : Card) (p : String) :
    eval c (.exists p) = (eval c (.missing p)).not ∧ eval c (.exists p) ≠ .unknown := by
  constructor
  · simp [eval]
  · cases h : c.slot p with
    | scalar v => cases v <;> simp [eval, noValue, h, Truth.ofBool, Truth.not]
    | list es =>
      cases hb : es.all Option.isNone <;>
        simp [eval, noValue, h, hb, Truth.ofBool, Truth.not]

/-! ### Type gates -/

theorem on_holds (c : Card) (t : String) (f : Filter) :
    eval c (.on t f) = Truth.and (.ofBool (c.isA t)) (eval c f) := by
  simp only [eval]
  cases c.isA t <;> simp [Truth.ofBool, Truth.and] <;> cases eval c f <;> rfl

/-- A gate does not move across a `not`: under `not`, a card of another type
is kept. -/
theorem gate_under_not (c : Card) (t : String) (f : Filter) (h : c.isA t = false) :
    holds c (.not (.on t f)) ∧ ¬ holds c (.on t (.not f)) := by
  simp [holds, eval, h, Truth.not]

/-! ### Lowering (QL-D1, QL-D4, QL-D6)

Lowering changes no answer, leaves nothing the engine would lower again,
and a newer query with top-level type `T` means its filter for cards of
`T`: the older spelling's `{ on: T, … }`. -/

theorem eval_lower (c : Card) : ∀ f : Filter, eval c (lower f) = eval c f
  | .type _ => by simp [lower]
  | .anchor _ => by simp [lower, eval]
  | .eq _ _ => by simp [lower]
  | .eqs _ => by simp [lower]
  | .inn _ _ => by simp [lower]
  | .contains _ _ => by simp [lower]
  | .range _ _ => by simp [lower]
  | .exists _ => by simp [lower, eval, eqLeaf]
  | .missing _ => by simp [lower, eval, eqLeaf]
  | .on t f => by simp only [lower, eval, eval_lower c f]
  | .not f => by simp only [lower, eval, eval_lower c f]
  | .any fs => by
    simp only [lower, eval, List.map_map]
    congr 1
    apply List.map_congr_left
    intro f _
    exact eval_lower c f
  | .every fs => by
    simp only [lower, eval, List.map_map]
    congr 1
    apply List.map_congr_left
    intro f _
    exact eval_lower c f

/-- Lowering refuses exactly what the authored filter does. -/
theorem refused_lower (k : String → Kind) : ∀ f : Filter, refused k (lower f) = refused k f
  | .type _ | .anchor _ | .eq _ _ | .eqs _ | .inn _ _ | .contains _ _ | .range _ _ => by
    simp [lower, refused]
  | .exists _ | .missing _ => by simp [lower, refused]
  | .on t f => by simp only [lower, refused, refused_lower k f]
  | .not f => by simp only [lower, refused, refused_lower k f]
  | .any fs => by
    simp only [lower, refused, List.map_map]
    congr 1
    apply List.map_congr_left
    intro f _
    exact refused_lower k f
  | .every fs => by
    simp only [lower, refused, List.map_map]
    congr 1
    apply List.map_congr_left
    intro f _
    exact refused_lower k f

theorem refused_lowerTyped (k : String → Kind) (T : String) (f : Filter) :
    refused k (lowerTyped T f) = refused k f := by
  rw [← refused_lower k f]
  unfold lowerTyped
  generalize lower f = g
  cases g with
  | on s g => by_cases h : s = T <;> simp [h, refused]
  | type s => by_cases h : s = T <;> simp [h, refused]
  | every fs => simp [refused]
  | _ => simp [refused]

theorem lower_engineForm : ∀ f : Filter, IsEngineForm (lower f)
  | .type _ | .eq _ _ | .eqs _ | .inn _ _ | .contains _ _ | .range _ _ => by
    simp [lower, IsEngineForm]
  | .anchor _ => by simp [lower, IsEngineForm]
  | .exists _ => by simp [lower, IsEngineForm]
  | .missing _ => by simp [lower, IsEngineForm]
  | .on _ f => by simpa [lower, IsEngineForm] using lower_engineForm f
  | .not f => by simpa [lower, IsEngineForm] using lower_engineForm f
  | .any fs => by
    simp only [lower, IsEngineForm, List.mem_map]
    rintro _ ⟨f, _, rfl⟩
    exact lower_engineForm f
  | .every fs => by
    simp only [lower, IsEngineForm, List.mem_map]
    rintro _ ⟨f, _, rfl⟩
    exact lower_engineForm f

theorem and_ofBool_idem (b : Bool) (x : Truth) :
    Truth.and (.ofBool b) (Truth.and (.ofBool b) x) = Truth.and (.ofBool b) x := by
  cases b <;> cases x <;> rfl

theorem lowerTyped_meaning (c : Card) (T : String) (f : Filter) :
    eval c (lowerTyped T f) = Truth.and (.ofBool (c.isA T)) (eval c f) := by
  rw [← eval_lower c f]
  unfold lowerTyped
  generalize lower f = g
  cases g with
  | on s g =>
    by_cases h : s = T
    · subst h
      simp only [ite_true]
      rw [on_holds, and_ofBool_idem]
    · simp only [h, ite_false]
      rw [on_holds, every_single]
  | type s =>
    by_cases h : s = T
    · subst h
      simp only [ite_true, eval]
      cases c.isA s <;> rfl
    · simp only [h, ite_false]
      rw [on_holds, every_single]
  | every fs => rw [on_holds]
  | _ => rw [on_holds, every_single]

/-- The two spellings of one query mean the same: `{ type: T, filter: f }`
is the older `{ on: T, … }` over `f`. -/
theorem spellings_agree (c : Card) (T : String) (f : Filter) :
    eval c (lowerTyped T f) = eval c (.on T f) := by
  rw [lowerTyped_meaning, on_holds]

end QueryV2
