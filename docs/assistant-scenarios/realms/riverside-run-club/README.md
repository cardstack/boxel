# Riverside Run Club: the assistant tour realm

The source of the `ctse/riverside-run-club` realm on staging. It holds
everything the recorded assistant tour uses, so anyone can open the realm and
repeat the prompts:

- the club's cards (`club.gts`, `runner.gts`, `route.gts`, `session.gts`,
  `race.gts`, `poster.gts`, `plan.gts`) in atom, fitted, embedded and isolated
  formats, and their data;
- `plan.gts`'s `SetPlanFieldsTool`, the one tool the tour writes the plan with;
- `TourScript/assistant-tour`, the card a newcomer opens first: setup, the
  prompts in order, and reset;
- `Environment/realm-runner`, which starts an assistant session with the Realm
  Runner tools and `skills/riverside-tour-director`;
- `FormatBoard/every-card`, every card at the sizes the assistant shows them;
- `showcase/`, the Pret UI assistant showcase card and the kit it renders with.

The Realm Runner modules stay in `ctse/assistant-realm-runner-poc`;
`tour-environment.gts` imports them from there.

To put this folder in a realm:

```
boxel realm push . https://realms-staging.stack.cards/ctse/riverside-run-club/
```

`showcase/kit/` is a copy of `packages/pretui` for realms whose host predates
it. Don't edit it here: refresh it by copying the changed files from
`packages/pretui` at a commit, then push the realm. `showcase/found-entries.gts`
is a realm copy of the host's FoundEntries, not part of the kit.

## The tour prompts

Open `Environment/realm-runner` and press its button to start a session with
the Realm Runner tools and the tour director, pick GPT-5.6 Luna and Act mode,
and open `RelaunchPlan/autumn` on the stack. Then send, in order:

1. "Who are our regulars?"
2. "Find flat routes under 8 km, and any races in November"
3. "Which poster should we use?" Then: Pick Night Shift.
4. "Pick an accent colour" Then: Pick Lime.
5. "When should the invite go out?" Then: Something else: Wednesday evening.
6. "Put all of that on the plan" Then: Press Update in the row.
7. "Mark everyone who ran 3 of the last 4 sessions as Regular"
8. "Should the relaunch run be a 5K, a 10K or a relay? Recommend one" Then: Go with 5K.
9. "Check the regulars' paces and ask me which group leads the 5K" Then: Switch to Ask first, press Run in the row, then pick a group.
10. "What do the races near Riverside Park charge for bibs?"
11. "Check kids' race fees borough by borough" Then: Scroll up while it runs, then press Stop at the second borough.
12. "Open the poster's code and give it a border in the plan's accent" Then: Undo on the row.
13. "Sum it up" Then: Click the plan card in the answer, then Escape.

Say "Reset the tour" in a new session to put the plan and the runners back.
`TourScript/assistant-tour` shows the same list in Boxel, with what each prompt
brings up.
