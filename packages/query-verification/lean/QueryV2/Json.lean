/-
Just enough JSON to write the vectors: the model's filters in the query
JSON a caller sends, and the cards they are evaluated over.
-/
import QueryV2.Filter

namespace QueryV2

inductive J where
  | null
  | bool (b : Bool)
  | str (s : String)
  | num (n : Int)
  /-- A number literal as written, such as a decimal (`10.25`). -/
  | lit (s : String)
  | arr (xs : List J)
  | obj (kvs : List (String × J))
  deriving Inhabited

def escape (s : String) : String :=
  s.foldl (fun acc ch =>
    acc ++ match ch with
      | '"' => "\\\""
      | '\\' => "\\\\"
      | '\n' => "\\n"
      | c => c.toString) ""

partial def J.render : J → String
  | .null => "null"
  | .bool b => if b then "true" else "false"
  | .str s => "\"" ++ escape s ++ "\""
  | .num n => toString n
  | .lit s => s
  | .arr xs => "[" ++ ",".intercalate (xs.map J.render) ++ "]"
  | .obj kvs =>
    "{" ++ ",".intercalate (kvs.map fun (k, v) => J.render (.str k) ++ ":" ++ v.render) ++ "}"

def Value.json : Value → J
  | .str s => .str s
  | .num n => .num n

def optJson : Option Value → J
  | none => .null
  | some v => v.json

/-- A type is written `$Name`; the test that reads the vectors stands each
for a code ref. -/
def typeRef (t : String) : J := .str ("$" ++ t)

def RangeOp.key : RangeOp → String
  | .gt => "gt"
  | .gte => "gte"
  | .lt => "lt"
  | .lte => "lte"

partial def Filter.json : Filter → J
  | .type t => .obj [("type", typeRef t)]
  | .anchor t => .obj [("on", typeRef t)]
  | .on t f =>
    match f.json with
    | .obj kvs =>
      -- `{type}` takes no `on` in either spelling (`CardTypeFilter`).
      if kvs.any (fun kv => kv.1 == "on" || kv.1 == "type") then .obj [("on", typeRef t), ("every", .arr [.obj kvs])]
      else .obj (("on", typeRef t) :: kvs)
    | other => .obj [("on", typeRef t), ("every", .arr [other])]
  | .eq p v => .obj [("eq", .obj [(p, optJson v)])]
  | .eqs kvs => .obj [("eq", .obj (kvs.map fun (p, v) => (p, optJson v)))]
  | .inn p vs => .obj [("in", .obj [(p, .arr (vs.map optJson))])]
  | .contains p s => .obj [("contains", .obj [(p, match s with | none => .null | some s => .str s)])]
  | .range p bs => .obj [("range", .obj [(p, .obj (bs.map fun (op, b) => (op.key, .num b)))])]
  | .exists p => .obj [("exists", .str p)]
  | .missing p => .obj [("missing", .str p)]
  | .not f => .obj [("not", f.json)]
  | .any fs => .obj [("any", .arr (fs.map Filter.json))]
  | .every fs => .obj [("every", .arr (fs.map Filter.json))]

end QueryV2
