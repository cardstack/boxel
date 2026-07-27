import { parseBuiltinJqFilters } from '../../jqtools/evaluate/filters/lib/parseBuiltinJqFilters.js';

export const formulaContribJqFilters = parseBuiltinJqFilters(`
def TRUE: true;
def FALSE: false;
def NA: "#N/A" | error;
def INDEX(array; row): _EXCEL_INDEX(array; row);
def INDEX(array; row; column): _EXCEL_INDEX(array; row; column);
def IF(test; value_if_true; value_if_false):
  . as $xl_in
  | if ($xl_in | test)
      then ($xl_in | value_if_true)
      else ($xl_in | value_if_false)
    end;
def IF(test; value_if_true): IF(test; value_if_true; false);
def IFERROR(value; value_if_error):
  . as $xl_in
  | try ($xl_in | value) catch ($xl_in | value_if_error);
def IFNA(value; value_if_na):
  . as $xl_in
  | try ($xl_in | value)
    catch if . == "#N/A" then ($xl_in | value_if_na) else error end;
def ISERROR(value):
  try (. as $xl_in | $xl_in | value | false) catch true;
def ISNA(value):
  try (. as $xl_in | $xl_in | value | false) catch (. == "#N/A");
def ISERR(value):
  try (. as $xl_in | $xl_in | value | false) catch (. != "#N/A");
def ERROR_TYPE(value):
  (
    try (. as $xl_in | $xl_in | value | "__XL_NO_ERROR__")
    catch (
      if . == "#NULL!" then 1
      elif . == "#DIV/0!" then 2
      elif . == "#VALUE!" then 3
      elif . == "#REF!" then 4
      elif . == "#NAME?" then 5
      elif . == "#NUM!" then 6
      elif . == "#N/A" then 7
      elif . == "#GETTING_DATA" then 8
      else NA end
    )
  )
  | if . == "__XL_NO_ERROR__" then NA else . end;
def IFS(c1; v1; c2; v2):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) else NA end;
def IFS(c1; v1; c2; v2; c3; v3):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) elif ($in | c3) then ($in | v3) else NA end;
def IFS(c1; v1; c2; v2; c3; v3; c4; v4):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) elif ($in | c3) then ($in | v3) elif ($in | c4) then ($in | v4) else NA end;
def IFS(c1; v1; c2; v2; c3; v3; c4; v4; c5; v5):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) elif ($in | c3) then ($in | v3) elif ($in | c4) then ($in | v4) elif ($in | c5) then ($in | v5) else NA end;
def IFS(c1; v1; c2; v2; c3; v3; c4; v4; c5; v5; c6; v6):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) elif ($in | c3) then ($in | v3) elif ($in | c4) then ($in | v4) elif ($in | c5) then ($in | v5) elif ($in | c6) then ($in | v6) else NA end;
def IFS(c1; v1; c2; v2; c3; v3; c4; v4; c5; v5; c6; v6; c7; v7):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) elif ($in | c3) then ($in | v3) elif ($in | c4) then ($in | v4) elif ($in | c5) then ($in | v5) elif ($in | c6) then ($in | v6) elif ($in | c7) then ($in | v7) else NA end;
def IFS(c1; v1; c2; v2; c3; v3; c4; v4; c5; v5; c6; v6; c7; v7; c8; v8):
  . as $in | if ($in | c1) then ($in | v1) elif ($in | c2) then ($in | v2) elif ($in | c3) then ($in | v3) elif ($in | c4) then ($in | v4) elif ($in | c5) then ($in | v5) elif ($in | c6) then ($in | v6) elif ($in | c7) then ($in | v7) elif ($in | c8) then ($in | v8) else NA end;

# BXL-native helpers (lowercase) + Excel helpers not yet expressed in jq.
# ISBLANK is defined as a native filter elsewhere with Excel-strict
# semantics (null only, NOT empty string). present(x) below is the
# looser, form-friendly positive form that treats "" as absent too.
def present(x):
  . as $in | [($in | x)][0] as $v | ($v != null) and ($v != "");

# when(p; q): conditional-requirement / implication.
# Reads "when p, require q" and vacuously passes when p is false.
# Excel shape is IF(p, q, TRUE); when(p; q) is the BXL shortcut.
def when(p; q):
  . as $in | if ($in | p) then ($in | q) else true end;

def implies(p; q): when(p; q);

# words(s): count whitespace-separated non-empty tokens. Excel has no
# direct equivalent; handles null gracefully and ignores double-spaces.
def words(s):
  . as $in | ($in | s) as $v
  | (($v // "") | split(" ") | map(select(. != "")) | length);

# nonempty(arr): strip nulls and empty strings from an array.
def nonempty(arr):
  . as $in | ($in | arr) | map(select(. != null and . != ""));

# overlaps(arr): true when the input array and arr share at least one value.
# This is the in-memory mirror of the predicate-profile SQL overlap operator.
def overlaps(arr):
  . as $left
  | arr as $right
  | if (($left | type) != "array") or (($right | type) != "array") then false
    else any($left[]; . as $item | any($right[]; . == $item))
    end;
`);
