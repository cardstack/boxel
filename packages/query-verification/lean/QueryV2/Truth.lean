/-
SQL's three truth values, and the AND and OR of a list of them.

A filter's answer for one card is one of these. `unknown` is SQL's NULL: a
comparison with a value the card does not have. A row is returned only when
its filter is `tt`, as a NULL WHERE drops the row.
-/
namespace QueryV2

inductive Truth where
  | tt
  | ff
  | unknown
  deriving DecidableEq, Repr, Inhabited

namespace Truth

def ofBool : Bool → Truth
  | true => tt
  | false => ff

def not : Truth → Truth
  | tt => ff
  | ff => tt
  | unknown => unknown

def and : Truth → Truth → Truth
  | ff, _ => ff
  | _, ff => ff
  | unknown, _ => unknown
  | _, unknown => unknown
  | tt, tt => tt

def or : Truth → Truth → Truth
  | tt, _ => tt
  | _, tt => tt
  | unknown, _ => unknown
  | _, unknown => unknown
  | ff, ff => ff

-- `every` and `any` read a list by membership alone: what is in it, never
-- where or how often. `all_cons` and `any_cons` show this is SQL's chain of
-- ANDs and ORs.
def all (l : List Truth) : Truth :=
  if ff ∈ l then ff else if unknown ∈ l then unknown else tt

def any (l : List Truth) : Truth :=
  if tt ∈ l then tt else if unknown ∈ l then unknown else ff

end Truth
end QueryV2
