/-
Lists the axioms each theorem rests on. `sorryAx` among them is an
unfinished proof; `pnpm prove` fails on it.
-/
import QueryV2

open QueryV2

#print axioms all_cons
#print axioms any_cons
#print axioms not_any
#print axioms not_all
#print axioms every_perm
#print axioms any_perm
#print axioms every_dup
#print axioms every_single
#print axioms in_congr
#print axioms missing_excluded
#print axioms list_two_valued
#print axioms empty_list_not
#print axioms exists_not_missing
#print axioms gate_under_not
#print axioms eval_lower
#print axioms lower_engineForm
#print axioms refused_lower
#print axioms refused_lowerTyped
#print axioms older_stays_older_top
#print axioms older_ignores_page
#print axioms older_ignores_node
#print axioms marker_makes_newer
#print axioms refuses_unknown_top
#print axioms newer_refuses_unknown_node
#print axioms mixed_rewrite
#print axioms lowerTyped_meaning
#print axioms spellings_agree
#print axioms reach_single
#print axioms compare_through_list
#print axioms empty_on_the_way
#print axioms reach_absent
#print axioms absent_before_list
