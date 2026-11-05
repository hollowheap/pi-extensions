#!/usr/bin/env bash
set -euo pipefail

packages=(
  @hollowheap/runtime
  @hollowheap/core
  @hollowheap/tui
  @hollowheap/policy
  @hollowheap/pi-autopilot
  @hollowheap/pi-dashboard
  @hollowheap/pi-decide
  @hollowheap/pi-hooks
  @hollowheap/pi-language-tools
  @hollowheap/pi-memory
  @hollowheap/pi-modal
  @hollowheap/pi-question
  @hollowheap/pi-statusline
  @hollowheap/pi-todos
  @hollowheap/pi-tools
  @hollowheap/pi-usage
  @hollowheap/pi-web
  @hollowheap/pi-agent
  @hollowheap/pi-tasks
  @hollowheap/pi-guard
  @hollowheap/pi-subagents
  @hollowheap/pi-acp
)

for package in "${packages[@]}"; do
  echo "publishing ${package}"
  npm publish -w "${package}" --access public
done
