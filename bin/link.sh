#!/bin/sh
# Keep npm's own bin executable. Do not write files outside the package.
chmod_ok() { chmod 755 "$1" 2>/dev/null || true; }

root=""
if [ -n "$npm_package_json" ] && [ -f "$npm_package_json" ]; then
  root=$(dirname "$npm_package_json")
elif [ -f "./package.json" ]; then
  root="."
fi

[ -n "$root" ] || exit 0
chmod_ok "$root/bin/msw.cjs"
chmod_ok "$root/bin/msw"
chmod_ok "$root/dist/cli.js"
exit 0
