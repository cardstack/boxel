# Ensure every host command module is imported, shimmed, and exported (`cardstack-host/host-commands-registered`)

<!-- end auto-generated rule header -->

Validates that every host command module in `app/commands/` is properly imported in the index, shimmed with `virtualNetwork.shimModule()`, and referenced in `HostCommandClasses` when applicable.
