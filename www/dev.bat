@echo off
echo Starting Tailwind Build Suite...

:: 1. Main Minified
start "Main Min" cmd /c ".\tw.exe -i input.css -o main.css --watch --content "./*.html,./html_extras/**/*.{html,md},./notebook_templates/**/*.{html,md}" --minify"

:: 2. Main Unminified (Full)
start "Main Max" cmd /c ".\tw.exe -i input.css -o main_max.css --watch --content "./*.html,./html_extras/**/*.{html,md},./notebook_templates/**/*.{html,md}""

:: 3. Prose Minified
start "Prose Min" cmd /c ".\tw.exe -i input_prose.css -o prose.css --watch --content "./*.html,./html_extras/**/*.{html,md},./notebook_templates/**/*.{html,md}" --minify"

:: 4. Prose Unminified (Full)
echo Watching Prose Max (Unminified)...
.\tw.exe -i input_prose.css -o prose_max.css --watch --content "./*.html,./html_extras/**/*.{html,md},./notebook_templates/**/*.{html,md}"

