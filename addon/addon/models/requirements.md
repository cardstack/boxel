High level - Minimal starting point?
Is imperative version too messy?

# Requirements
- Contexts can specify which sprites they want to handle (selection DSL)
- Multiple selections can be animated
- Kept sprite handling - should have a way of differentiating whether something changed or not
- For initial version, only one selection can take a sprite (so we don't have 2 transitions applying to the same sprite)
  - implementation: mark sprite as selected/remove sprite from selection pool
  - is there any practical purpose to multiple selections?
- Selection DSL needs specificity rules
  - Unsure if manually specified or automatically determined
  - To think about: Outer context wins if both contexts want to handle a sprite?
- How narrow does the selection criteria need to be?
  - Do we need to identify contexts that we want to reach into from an outer context?
- Selection based on DOM/UI state. Example:
  > After an interruption, there is no way to know if the original intent still applies. We need to discover anew what is moving. But there's enough information in the new initial state to do all the thing you're describing. The rule would be: if the destination size is below a certain threshold, the fade is fast, otherwise it's slow. That rule would continue to work through interruptions as long as the final destination remains small. Whereas if an interruption changes the final destination to be big, it's actually good that a different rule would apply. 
- it should always be clear when cloning is happening
  - opt-in, prefer user to decide whether to clone
- Orchestration? 
  - follow API?
  - sequences + parallel animations
  - do we need to be able to hook into other transitions? other context, self, parent, sibling? 
    - how to reference other contexts? (user-specified arg) or a specific type of animation, or sprite within a context?
    - unsure if initial v or later
    - selector for another context?
    - similar to sequence/parallel animation within a single context

Keep DSL simple for now, extend later

## To investigate
- Is it possible to get modified sprite modifier arguments in time to check dynamic args for transitions?

## Later
- Selection DSL should be able to differentiate related sprites from unrelated ones
- Nesting selection conditions?
- Selection based on "intent"? From where? 

## Related
- containment rules

# Cloning
- Clone something, put it in the right layer

## Later
- Clipping?

# Declarative higher level API?
- Do we always want lockStyles for orphans?
  - Should we use keyframes to handle the locking of styles instead of setting styles on elements?
- Arbitrary things in transitions?
  - Scheduler? Not web animations events?
  - Start/end are possible with web animations API
  - Poll current time? 
  - Drift when scheduled w fixed time?
- Function that returns object?
- Escape hatch - imperative?

# Language for DSL
- As close to CSS/our abstractions over CSS (like scale vs width) as possible
- Complete words where possible



changeset
    // initial v: match on id, type, role
    // future, have arbitrary sprite modifier argument handling?
