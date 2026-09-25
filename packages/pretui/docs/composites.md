# The composites group

Design notes shared by **OtpInput**, **TimeInput**, **StepList**, **ButtonGroup**, **Divider**.

controls territory, form-composites wave: segmented entry
(OtpInput, TimeInput), progress structure (StepList), and grouping
chrome (ButtonGroup, Divider). Semantics transcribed — not copied — from
Web Awesome's wa-otp-input / wa-time-input / wa-button-group / wa-divider
(MIT, (c) Fonticons) and React Spectrum's StepList (Apache-2.0, (c)
Adobe), re-cut on the kit's own bones: Pretui tokens + light fallbacks,
the value?/defaultValue?/onValueChange? contract, data-test-pretui-_ +
data-_ state reflection, and no document-level listeners anywhere.
Wave-0 adaptations are documented per component.
