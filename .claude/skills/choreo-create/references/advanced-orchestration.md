# Advanced orchestration: choose by dependency

Use `choreo-scene` for the basic changeset and timeline. For these more specific
problems, read the matching guide under
`packages/choreo-test-app/app/content/guides/` and inspect the real example. Do not load the entire API inventory into the prompt.

| Problem                                           | Concept / guide                                                           | Example                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| A person advances one thought                     | Gate / interactive-gates.md                                               | presentation, rack                                    |
| A beat starts with or after another               | named scheduling / film-schedule.md                                       | build-order                                           |
| A property comes from measured geometry           | property functions / interactive-property-steps.md                        | split                                                 |
| A destination is a location                       | anchors, beacons / interactive-anchors.md                                 | inbox                                                 |
| A badge follows the actual driven value           | Follow / interactive-follow.md                                            | escort, hang                                          |
| A line connects moving endpoints                  | Tether / interactive-tethers.md                                           | wires                                                 |
| A transfer must complete a delivery contract      | interactive-delivery.md                                                   | read the current exported step and its contract tests |
| Scrolling and temporary emphasis explain a target | Raise, Scroll, Hold / interactive-raise-scroll.md                         | jump                                                  |
| A command changes semantic app state              | Perform / interactive-commands.md                                         | fold, playhead                                        |
| A pass should run only for an intended operation  | arming / interactive-arming.md                                            | inline-edit, crossing                                 |
| A repeated pattern needs its own vocabulary       | composites, registry / interactive-composites.md; interactive-registry.md | escort and exported StepComponent contracts           |
| Work crosses independent regions                  | matching / interactive-regions.md                                         | far, lists                                            |

A derived value reads what the leader is doing now; it does not guess a second
curve. A command needs a reset/reconstruction policy if seeking can cross it
backward. A gesture includes release velocity that cannot be recovered from a
layout box. A continuous simulation keeps its own integration model; Choreo
explains its discrete structural changes (drift and hang demonstrate this boundary).

For a teaching task, use the demo's `lesson` in
`packages/choreo-gallery/realm/demos/<id>.json` to locate the specific
experiment and pitfall, then verify them against the source. API names
being indexed or a demo being embedded does not establish that a concept has
been taught. Add only the missing explanation, not a duplicate general tutorial.
