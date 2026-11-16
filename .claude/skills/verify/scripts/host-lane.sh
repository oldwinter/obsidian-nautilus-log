#!/usr/bin/env bash
# Drive Spiral Day inside a real, disposable Obsidian host and summarize the result.
#
#   scripts/host-lane.sh probe            # ~40 s, read-only Planner probe
#   scripts/host-lane.sh full             # ~2 min, lifecycle + CLOCK writes
#   scripts/host-lane.sh review           # ~5 min, adds the Review matrix
#
# Env:
#   RUN_NAME           evidence folder name (default: UTC timestamp)
#   OBSIDIAN_BIN       Obsidian executable (default: /Applications/Obsidian.app/Contents/MacOS/Obsidian)
#   PLAYWRIGHT_MODULE  installed `playwright` module path; auto-detected when omitted
#   SKIP_BUILD=1       reuse the existing main.js/styles.css
set -euo pipefail

skill_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
repo_root=$(cd "$skill_dir/../../.." && pwd)
lane=${1:-probe}
case "$lane" in probe|full|review) ;; *) echo "usage: $0 [probe|full|review]" >&2; exit 2;; esac

node_pin=24.20.0
obsidian_bin=${OBSIDIAN_BIN:-/Applications/Obsidian.app/Contents/MacOS/Obsidian}
run_name=${RUN_NAME:-$(date -u +%Y%m%dT%H%M%SZ)}
evidence="$repo_root/.codex/runtime/verify/$run_name"
doctor_failed=0

report() { printf '%-4s %s: %s\n' "$1" "$2" "$3"; }

if command -v mise >/dev/null 2>&1 && mise exec "node@$node_pin" -- node -v >/dev/null 2>&1; then
  NODE=(mise exec "node@$node_pin" -- node)
  NPM=(mise exec "node@$node_pin" -- npm)
else
  NODE=(node)
  NPM=(npm)
fi
node_version=$("${NODE[@]}" -v 2>/dev/null || echo missing)
if [ "$node_version" = "v$node_pin" ]; then
  report ok node "$node_version"
else
  report fail node "$node_version (the host runner and npm test are pinned to v$node_pin)"; doctor_failed=1
fi

if [ -x "$obsidian_bin" ]; then
  report ok obsidian "$obsidian_bin"
else
  report fail obsidian "not executable: $obsidian_bin (set OBSIDIAN_BIN)"; doctor_failed=1
fi

playwright_module=${PLAYWRIGHT_MODULE:-}
if [ -z "$playwright_module" ]; then
  while IFS= read -r candidate; do playwright_module=$candidate; break; done < <(
    for path in "$HOME"/Code/*/node_modules/playwright "$HOME"/Code/*/*/node_modules/playwright \
      "$HOME"/.local/state/gt-e2e-verify-sweep/*/work/*/node_modules/playwright \
      "$HOME"/.local/state/gt-e2e-verify-sweep/*/work/*/apps/*/node_modules/playwright; do
      [ -d "$path" ] && echo "$path"
    done 2>/dev/null
  )
fi
if [ -n "$playwright_module" ] && "${NODE[@]}" -e "require.resolve('$playwright_module')" >/dev/null 2>&1; then
  report ok playwright "$playwright_module"
else
  report fail playwright "set PLAYWRIGHT_MODULE to an installed playwright module (node -p \"require.resolve('playwright')\" in a project that has it)"; doctor_failed=1
fi

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  build_log=$(mktemp)
  if ! ( cd "$repo_root" && "${NPM[@]}" run build ) > "$build_log" 2>&1; then
    tail -20 "$build_log"
    report fail build "npm run build failed (full log above)"; doctor_failed=1
  else
    grep -E '^(build|validate):' "$build_log" || true
  fi
  rm -f "$build_log"
fi
missing=""
for file in main.js manifest.json styles.css; do [ -f "$repo_root/$file" ] || missing="$missing $file"; done
if [ -z "$missing" ]; then
  report ok package "main.js manifest.json styles.css present"
else
  report fail package "missing:$missing"; doctor_failed=1
fi
if [ ! -f "$repo_root/node_modules/esbuild/package.json" ]; then
  report fail deps "node_modules/esbuild is missing; run npm ci with node@$node_pin"; doctor_failed=1
fi

if [ "$doctor_failed" = "1" ]; then
  echo "doctor failed; not driving the host. Evidence dir untouched: $evidence"
  exit 1
fi

mkdir -p "$evidence"
case "$lane" in
  probe) lane_flags=(--planner-tooltip-only) ;;
  full) lane_flags=() ;;
  review) lane_flags=(--review) ;;
esac
host_out="$evidence/host-$lane"
set +e
( cd "$repo_root" && PLAYWRIGHT_MODULE="$playwright_module" "${NODE[@]}" tests/host-matrix/run.mjs \
    --executable "$obsidian_bin" --plugin-dir "$repo_root" --output "$host_out" "${lane_flags[@]}" ) \
  > "$evidence/host-$lane.log" 2>&1
runner_status=$?
set -e
tail -3 "$evidence/host-$lane.log"

report_path="$host_out/evidence/report.json"
if [ -f "$report_path" ]; then
  "${NODE[@]}" "$skill_dir/scripts/summarize-report.mjs" "$report_path" || true
else
  echo "no report.json at $report_path" >&2
fi
echo "evidence: $evidence"
exit "$runner_status"
