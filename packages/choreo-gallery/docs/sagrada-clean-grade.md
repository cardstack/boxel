# Material-first film grade

The model HTML now attenuates the film's authored looks at the final uniform
boundary. The shot list, camera paths, chapter timing and transition logic are
unchanged.

- Grain, chromatic aberration and milky black lift: off.
- LUT strength: 12% of the authored amount.
- Saturation, contrast and brightness deviations from neutral: 20%.
- Sepia, hue rotation and split-tone strength: 15%.
- Vignettes: 20%; paper wash: 30%; cloud overlay: 15%.
- HDR highlight handling, physical lighting, annotation dimming and seams: kept.

Before/after render checks use `SAGRADA_REVIEW_GRADE=1` with the model-review
script. This deliberately enables a strong stock, wash and grade so the comparison
tests the changed path rather than neutral inspection settings.
