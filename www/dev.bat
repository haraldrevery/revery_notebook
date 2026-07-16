@echo off
rem Tailwind dev watcher. Paths resolve relative to www\ (this script's dir).
rem Binary lives in build_tools\ (not shipped with the app). Inputs live in
rem css_aesthetics\; the minified outputs main_rn.css / prose_rn.css in www\
rem are the ones the app actually loads. The *_max.css unminified twins are
rem written next to the inputs for debugging.
rem Which files get scanned for class names is declared with @source inside
rem the input files (auto-detection is disabled there with source(none)).
rem For one-shot builds use: npm run build:css
cd /d "%~dp0"

set TW=..\build_tools\tw.exe
if not exist "%TW%" (
  echo Tailwind binary not found at %TW%
  echo Download it from https://github.com/tailwindlabs/tailwindcss/releases
  exit /b 1
)

echo Starting Tailwind Build Suite...

:: 1. Main Minified (live stylesheet)
start "Main Min" cmd /c ""%TW%" -i css_aesthetics/input.css -o main_rn.css --watch --minify"

:: 2. Main Unminified (debug copy)
start "Main Max" cmd /c ""%TW%" -i css_aesthetics/input.css -o css_aesthetics/main_max.css --watch"

:: 3. Prose Minified (live stylesheet)
start "Prose Min" cmd /c ""%TW%" -i css_aesthetics/input_prose.css -o prose_rn.css --watch --minify"

:: 4. Prose Unminified (debug copy)
echo Watching Prose Max (Unminified)...
"%TW%" -i css_aesthetics/input_prose.css -o css_aesthetics/prose_max.css --watch
