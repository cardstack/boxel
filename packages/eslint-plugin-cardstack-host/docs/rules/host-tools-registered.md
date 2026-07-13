# Ensure every host tool module is imported, shimmed, and exported (`@cardstack/host/host-tools-registered`)

💼 This rule is enabled in the ✅ `recommended` config.

<!-- end auto-generated rule header -->

Validates that every host tool module in `app/tools/` is properly imported in the index, shimmed with `shimHostToolModule()` (which registers both the `@cardstack/boxel-host/tools/*` specifier and its pre-rename `commands/*` alias), and referenced in `HostCommandClasses` when applicable.
