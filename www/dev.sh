#!/bin/bash
# Tailwind dev watcher. Run from anywhere; paths resolve relative to www/.
# Binary lives in build_tools/ (not shipped with the app). Inputs live in
# css_aesthetics/; the minified outputs main_rn.css / prose_rn.css in www/
# are the ones the app actually loads. The *_max.css unminified twins are
# written next to the inputs for debugging.
# Which files get scanned for class names is declared with @source inside
# the input files (auto-detection is disabled there with `source(none)`).
# For one-shot builds use: npm run build:css
cd "$(dirname "$0")" || exit 1

TW=../build_tools/tailwindcss-linux-x64
if [ ! -x "$TW" ]; then
  echo "Tailwind binary not found at $TW"
  echo "Download it from https://github.com/tailwindlabs/tailwindcss/releases"
  exit 1
fi

echo "Starting Tailwind Build Suite..."

# Pipe an infinite empty stream into the background processes
# to keep stdin open and prevent Tailwind CLI from auto-exiting.

# 1. Main Minified (live stylesheet)
tail -f /dev/null | "$TW" -i css_aesthetics/input.css -o main_rn.css --watch --minify &

# 2. Main Unminified (debug copy)
tail -f /dev/null | "$TW" -i css_aesthetics/input.css -o css_aesthetics/main_max.css --watch &

# 3. Prose Minified (live stylesheet)
tail -f /dev/null | "$TW" -i css_aesthetics/input_prose.css -o prose_rn.css --watch --minify &

# 4. Prose Unminified (debug copy)
# (Stays in the foreground, so it already has an open stdin and doesn't need the pipe)
echo "Watching Prose Max (Unminified)..."
"$TW" -i css_aesthetics/input_prose.css -o css_aesthetics/prose_max.css --watch
