@echo off
rem Tailwind dev watcher. Paths resolve relative to www\ (this script's dir).
rem Binary lives in build_tools\ (not shipped with the app). Inputs live in
rem css_aesthetics\; the minified outputs main.css / prose.css in www\ are the
rem ones the app actually loads. The *_max.css unminified twins are written
rem next to the inputs for debugging.
cd /d "%~dp0"

set TW=..\build_tools\tw.exe
if not exist "%TW%" (
  echo Tailwind binary not found at %TW%
  echo Download it from https://github.com/tailwindlabs/tailwindcss/releases
  exit /b 1
)

set CONTENT=./*.html,./html_extras/**/*.{html,md},./notebook_templates/**/*.{html,md}

echo Starting Tailwind Build Suite...

:: 1. Main Minified (live stylesheet)
start "Main Min" cmd /c ""%TW%" -i css_aesthetics/input.css -o main.css --watch --content "%CONTENT%" --minify"

:: 2. Main Unminified (debug copy)
start "Main Max" cmd /c ""%TW%" -i css_aesthetics/input.css -o css_aesthetics/main_max.css --watch --content "%CONTENT%""

:: 3. Prose Minified (live stylesheet)
start "Prose Min" cmd /c ""%TW%" -i css_aesthetics/input_prose.css -o prose.css --watch --content "%CONTENT%" --minify"

:: 4. Prose Unminified (debug copy)
echo Watching Prose Max (Unminified)...
"%TW%" -i css_aesthetics/input_prose.css -o css_aesthetics/prose_max.css --watch --content "%CONTENT%"
