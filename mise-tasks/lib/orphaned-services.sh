_signal_checkout_orphans() {
  _sco_signal="$1"
  _sco_pattern="$2"
  _sco_root="$(cd "$REPO_ROOT" && pwd -P)" || return 0
  for _sco_pid in $(pgrep -f "$_sco_pattern" 2>/dev/null || true); do
    _sco_parent="$(ps -p "$_sco_pid" -o ppid= 2>/dev/null | tr -d '[:space:]')"
    [ "$_sco_parent" = 1 ] || continue
    if [ -d "/proc/$_sco_pid" ]; then
      _sco_cwd="$(readlink "/proc/$_sco_pid/cwd" 2>/dev/null || true)"
    else
      _sco_cwd="$(lsof -a -p "$_sco_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    fi
    case "$_sco_cwd" in
      "$_sco_root"|"$_sco_root"/*) ;;
      *) continue ;;
    esac
    _sco_parent="$(ps -p "$_sco_pid" -o ppid= 2>/dev/null | tr -d '[:space:]')"
    [ "$_sco_parent" = 1 ] || continue
    if kill -"$_sco_signal" "$_sco_pid" 2>/dev/null; then
      printf '[dev cleanup] Sent %s to checkout orphan pid %s\n' "$_sco_signal" "$_sco_pid"
    fi
  done
}

sweep_orphaned_services() {
  if [ -n "${BOXEL_ENVIRONMENT:-}" ] && [ -z "${SWEEP_FORCE:-}" ]; then
    "$REPO_ROOT/scripts/stop-environment.sh" "$BOXEL_ENVIRONMENT" || true
    return 0
  fi
  if [ -z "${SWEEP_FORCE:-}" ] && pgrep -f '/mise-tasks/dev-all$|/mise-tasks/dev$' >/dev/null 2>&1; then
    return 0
  fi
  REPO_ROOT_RE="$(printf '%s' "$REPO_ROOT" | sed -E 's/[][\\.*^$+?(){}|]/\\&/g')"
  REALM_NODE_RE="(main\.ts .*--realmsRootPath|worker-manager\.ts .*--allPriorityCount|prerender/(prerender|manager)-server\.ts)"
  VITE_SERVE_RE="scripts/vite-serve\.js"
  VITE_BIN_RE="${REPO_ROOT_RE}/packages/host/.*vite/bin/vite\.js"
  SAT_RE="${REPO_ROOT_RE}/.*node_modules/.*start-server-and-test/src/bin/start\.js"
  RUNP_RE="${REPO_ROOT_RE}/.*node_modules/.*npm-run-all/bin/run-p"
  HTTP_SERVER_RE="http-server.*X-Boxel-Assume-User.*--port 4206"
  for sig in TERM KILL; do
    _signal_checkout_orphans "$sig" "${REPO_ROOT_RE}/mise-tasks/services/"
    _signal_checkout_orphans "$sig" "$REALM_NODE_RE"
    _signal_checkout_orphans "$sig" "$VITE_SERVE_RE"
    _signal_checkout_orphans "$sig" "$VITE_BIN_RE"
    _signal_checkout_orphans "$sig" "$SAT_RE"
    _signal_checkout_orphans "$sig" "$RUNP_RE"
    _signal_checkout_orphans "$sig" "$HTTP_SERVER_RE"
    if [ "$sig" = "TERM" ]; then
      sleep "$SWEEP_GRACE_SECS"
    fi
  done
}

