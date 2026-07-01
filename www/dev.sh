#!/bin/bash
# Tailwind dev watcher. Run from anywhere; paths resolve relative to www/.
# Binary lives in build_tools/ (not shipped with the app). Inputs live in
# css_aesthetics/; the minified outputs main.css / prose.css in www/ are the
# ones the app actually loads. The *_max.css unminified twins are written
# next to the inputs for debugging.
cd "$(dirname "$0")" || exit 1

TW=../build_tools/tailwindcss-linux-x64
if [ ! -x "$TW" ]; then
  echo "Tailwind binary not found at $TW"
  echo "Download it from https://github.com/tailwindlabs/tailwindcss/releases"
  exit 1
fi

CONTENT="./*.html,./html_extras/**/*.{html,md},./notebook_templates/**/*.{html,md}"

echo "Starting Tailwind Build Suite..."

# Pipe an infinite empty stream into the background processes
# to keep stdin open and prevent Tailwind CLI from auto-exiting.

# 1. Main Minified (live stylesheet)
tail -f /dev/null | "$TW" -i css_aesthetics/input.css -o main.css --watch --content "$CONTENT" --minify &

# 2. Main Unminified (debug copy)
tail -f /dev/null | "$TW" -i css_aesthetics/input.css -o css_aesthetics/main_max.css --watch --content "$CONTENT" &

# 3. Prose Minified (live stylesheet)
tail -f /dev/null | "$TW" -i css_aesthetics/input_prose.css -o prose.css --watch --content "$CONTENT" --minify &

# 4. Prose Unminified (debug copy)
# (Stays in the foreground, so it already has an open stdin and doesn't need the pipe)
echo "Watching Prose Max (Unminified)..."
"$TW" -i css_aesthetics/input_prose.css -o css_aesthetics/prose_max.css --watch --content "$CONTENT"
