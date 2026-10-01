# Building a Spatial Gallery

A gallery gives the viewer a place to explore. Its architecture, exhibit sizes, and camera paths should help them understand the capabilities on display.

The [Choreo 3D gallery](/_widgets) is the complete example. It includes framed demos, physical section signs, free exploration, a highlights tour, and a longer narrated tour.

## Organizing the Room

Group exhibits by what they demonstrate. A sequence of related interactions is easier to understand than a wall ordered by component filename. Let the room's changes in direction and lighting separate those groups, and place section signs where they can be read before approaching an exhibit.

Measure each demo in its expanded state. Use those measurements to allocate its frame and the space around it. A masonry arrangement can accommodate different proportions without forcing every interface into the same small rectangle.

## Moving from an Overview to an Exhibit

The room needs both overview and reading views. A wide camera introduces the category. A closer view makes the active interface usable. Plan the route between them around the next point in the tour instead of stopping at every tile for an identical length of time.

Keep the current preview visible while activating the real component. Replace it only after the component has rendered its meaningful content, including models and textures when applicable. A mounted element alone does not prove that its picture is ready.

## Budgeting Live Work

Inactive demos can show prepared previews while the focused demo remains live. This reduces competing animation loops and WebGL work on mobile browsers. Closing or leaving an exhibit should release its active work according to the host's lifecycle.

Test the overview separately from the close-up. A room can be smooth with one active exhibit and still stutter when many framed surfaces are visible. Review frame rate, memory, and activation transitions on the intended device.

## Adding a Guided Tour

Write the explanation before assigning camera stops. Describe what's worth watching, then trigger the action that demonstrates it. Use one transport to coordinate the camera, pointer, overlays, and narration.

See [Narration and Overlays](/docs/film-audio) for separate audio clips and [Recording and Deployment](/docs/film-delivery) for the final delivery checks.
