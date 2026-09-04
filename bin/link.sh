#!/bin/sh
# Best-effort global launcher. Never fail the npm install.
exit_ok() { exit 0; }
trap exit_ok EXIT INT TERM

is_global() {
  [ "$npm_config_global" = "true" ] || [ "$npm_config_global" = "TRUE" ]
}

resolve_src() {
  if [ -n "$npm_package_json" ] && [ -f "$npm_package_json" ]; then
    echo "$(dirname "$npm_package_json")/bin/msw.cjs"
    return
  fi
  if [ -n "$npm_config_prefix" ] && [ -f "$npm_config_prefix/lib/node_modules/model-switch/bin/msw.cjs" ]; then
    echo "$npm_config_prefix/lib/node_modules/model-switch/bin/msw.cjs"
    return
  fi
  case "$0" in
    /*) echo "$(dirname "$0")/msw.cjs" ;;
    *) echo "" ;;
  esac
}

write_launcher() {
  dest_dir="$1"
  src="$2"
  [ -n "$dest_dir" ] || return 0
  mkdir -p "$dest_dir" 2>/dev/null || return 0
  launcher="$dest_dir/msw"
  printf '#!/bin/sh\nexec node "%s" "$@"\n' "$src" > "$launcher" 2>/dev/null || return 0
  chmod 755 "$launcher" 2>/dev/null || return 0
  printf '#!/bin/sh\nexec node "%s" "$@"\n' "$src" > "$dest_dir/model-switch" 2>/dev/null || return 0
  chmod 755 "$dest_dir/model-switch" 2>/dev/null || return 0
}

is_global || exit 0

src=$(resolve_src)
[ -n "$src" ] && [ -f "$src" ] || exit 0

if [ -n "$npm_config_prefix" ]; then
  write_launcher "$npm_config_prefix/bin" "$src"
fi

node_path=$(command -v node 2>/dev/null) || node_path=""
if [ -n "$node_path" ]; then
  write_launcher "$(dirname "$node_path")" "$src"
fi

if [ -n "$HOME" ]; then
  write_launcher "$HOME/.local/bin" "$src"
  write_launcher "$HOME/bin" "$src"
fi
