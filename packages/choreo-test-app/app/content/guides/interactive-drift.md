# Keeping Simulation and Choreography Separate

The Drift example lets a person tune a car while driving it. Its teaching value is the boundary between continuous simulation and discrete interface choreography. The driving model owns the car's response to input. Choreo owns transitions around that model, such as participants arriving, moving or leaving. Your goal is to identify which system should consume a parameter before adding a control for it.

## Start with the driving question

Hold the pointer on the track and observe how the car turns toward it. Change a driving variable, continue holding the input, and observe the next turn. Grip, steering, power and damping affect an ongoing physical model. They are not aliases for the duration of a rectangle's entrance animation.

The existing car panel exposes the simulation's own variables. Keep those controls connected to the same store instance that the model reads. A panel can render convincing numbers while doing nothing if the consumer subscribes to a different bundled singleton or retains an old snapshot.

## Identify discrete changes

Read the Choreo participants and their roles in the template. Inserted, moved, removed and still selections describe the changes that belong to a render pass. Those are the places where arrival, shuffle and departure springs apply. Bouncy parking and Precision parking tune these surrounding transitions; they should not be described as changing tyre grip.

This distinction makes the demo useful for real applications. A simulation, editor or live data feed can continue owning its internal state while Choreo explains structural changes around it. Avoid forcing every continuous update into a new scene or treating every frame as a component rerender.

## Design an honest experiment

Drive the same broad path with two grip settings and compare the turn. Then restore the driving defaults and compare the two choreography presets during an arrival or rearrangement. Keeping the experiments separate makes it clear which parameter caused the difference.

If a recording needs a repeatable driving moment, define how to reconstruct the simulation state and its input history. A timestamp alone does not make a history-dependent simulation deterministic. A guided film can instead use a prepared state and a defined input sequence with a controlled integration clock.

Continue with [commands](/docs/interactive-commands) for semantic actions and [film transport](/docs/film-transport) for explicit clock ownership.
