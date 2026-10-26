#!/usr/bin/env bash
set -euo pipefail
if command -v artifacts.sh >/dev/null 2>&1; then
  exec artifacts.sh "$@"
fi
for helper in \
  "${HOME}/.gemini/config/skills/specify/scripts/artifacts.sh" \
  "/home/hollowheap/repos/home-manager/pkgs/artifacts-helper.sh"; do
  if [ -r "$helper" ]; then
    exec bash "$helper" "$@"
  fi
done
exec artifacts.sh "$@"
