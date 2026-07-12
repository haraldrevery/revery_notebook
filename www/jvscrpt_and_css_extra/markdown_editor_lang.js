// Safely initialize global language (checking storage to prevent English flash on boot)
window.uiLanguage = 'English';
try {
  const stored = localStorage.getItem('revery_md_settings');
  if (stored) {
    const s = JSON.parse(stored);
    if (s.uiLanguage) window.uiLanguage = s.uiLanguage;
  }
} catch (e) {}

// ── Translation Engine ───────────────────────────────────────────────────
window.uiTranslations = {
  // Panes & Topbar
  "Markdown": { "Swedish": "Markdown" },
  "Preview": { "Swedish": "Förhandsgr." },
  "Outline": { "Swedish": "Disposition" },
  "File ▾": { "Swedish": "Arkiv ▾" },
  "File": { "Swedish": "Arkiv" },
  "Settings ▾": { "Swedish": "Inställningar ▾" },
  "Set.": { "Swedish": "Inst." },
  "Toolbar ▾": { "Swedish": "Verktyg ▾" },
  "Tool.": { "Swedish": "Verk." },
  "Export .md": { "Swedish": "Exportera .md" },
  "Export": { "Swedish": "Export" },
  "Reader Mode": { "Swedish": "Läsläge" },
  "Exit Reader Mode": { "Swedish": "Avsluta läsläge" },
  "Nothing here yet": { "Swedish": "Inget här ännu" },
  "Untitled": { "Swedish": "Namnlös" },
  "Start writing…": { "Swedish": "Börja skriva…" },
  "Editor": { "Swedish": "Redigerare" },
  
// Settings Menu Items
"Show Preview": { "Swedish": "Visa förhandsgranskning" },
  "Show Outline": { "Swedish": "Visa disposition" },
  "Show Word Counter": { "Swedish": "Visa ordräknare" },
  "Show Line Numbers": { "Swedish": "Visa radnummer" },
  "Mobile View": { "Swedish": "Mobilvy" },
  "Reader padding ▸": { "Swedish": "Läsläge marginal ▸" },
  "Drag to adjust": { "Swedish": "Justera med drag" },
  "Custom": { "Swedish": "Anpassad" },
  "Editor padding ▸": { "Swedish": "Redig. marginal ▸" },
  "Default": { "Swedish": "Standard" },
  "Calendar format ▸": { "Swedish": "Kalenderformat ▸" },
  "Filename format ▸": { "Swedish": "Filnamnsformat ▸" },
  "Editor text size ▸": { "Swedish": "Redig. textstorlek ▸" },
  "Editor font type ▸": { "Swedish": "Redig. typsnitt ▸" },
  "Preview text size ▸": { "Swedish": "Förh.granskn. textstorlek ▸" },
  "Preview font type ▸": { "Swedish": "Förh.granskn. typsnitt ▸" },
  "Outline font size ▸": { "Swedish": "Disposition textstorlek ▸" },
  "UI menu size ▸": { "Swedish": "UI-meny storlek ▸" },
  "Language ▸": { "Swedish": "Språk ▸" },
  "English": { "Swedish": "Engelska" },
  "Swedish": { "Swedish": "Svenska" },
  "CPU performance delay ▸": { "Swedish": "CPU-fördröjning ▸" },
  "Forced Prev. Synch": { "Swedish": "Tvinga förhandsgr. synk" },
  "Deactivate Right Click": { "Swedish": "Inaktivera högerklick" },
  "Center Headers": { "Swedish": "Centrera rubriker" },

  // Scratchpad crash recovery (project_sidebar.js)
  "Recover unsaved text?": { "Swedish": "Återställ osparad text?" },
  "Text typed in a previous session was never saved to a file.": { "Swedish": "Text som skrevs i en tidigare session sparades aldrig till en fil." },
  "Last edited:": { "Swedish": "Senast ändrad:" },
  "\u201CRecover\u201D writes it into a new file in your project. \u201CDiscard\u201D deletes the backup permanently. \u201CNot now\u201D keeps the backup and asks again next time.": { "Swedish": "\u201DÅterställ\u201D skriver texten till en ny fil i ditt projekt. \u201DSläng\u201D raderar säkerhetskopian permanent. \u201DInte nu\u201D behåller kopian och frågar igen nästa gång." },
  "Recover": { "Swedish": "Återställ" },
  "Discard": { "Swedish": "Släng" },
  "Not now": { "Swedish": "Inte nu" },
  "Recovery Failed": { "Swedish": "Återställning misslyckades" },
  "The recovered text could not be written to a new file.": { "Swedish": "Den återställda texten kunde inte skrivas till en ny fil." },
  "The backup was kept. You will be asked again on the next start.": { "Swedish": "Säkerhetskopian behölls. Du tillfrågas igen vid nästa start." },
// Theme submenu (Settings)
  "Theme ▸": { "Swedish": "Tema ▸" },
  "System": { "Swedish": "System" },
  "Light": { "Swedish": "Ljust" },
  "Dark": { "Swedish": "Mörkt" },
  "Paper": { "Swedish": "Papper" },
  "Forest": { "Swedish": "Skog" },
  
  // Background submenu (Settings)
  "Background ▸": { "Swedish": "Bakgrund ▸" },
  "None": { "Swedish": "Ingen" },
  "Galdhøpiggen": { "Swedish": "Galdhøpiggen" },
  "Rocks": { "Swedish": "Klippor" },
  "Matterhorn": { "Swedish": "Matterhorn" },
  "Alpern": { "Swedish": "Alperna" },
  "Grass": { "Swedish": "Gräs" },
  "Tree": { "Swedish": "Träden" },
  "Tjurpannan": { "Swedish": "Tjurpannan" },


// File Menu
  "New File": { "Swedish": "Ny fil" },
  "New Folder": { "Swedish": "Ny mapp" },
  "Import File": { "Swedish": "Importera fil" },
  "Import Template ▸": { "Swedish": "Importera mall ▸" },
  "Zip Project Export": { "Swedish": "Zip-export av projekt" },
  "Open a project folder first.": { "Swedish": "Öppna en projektmapp först." },
  "Project exported.": { "Swedish": "Projektet har exporterats." },
  "items": { "Swedish": "objekt" },
  "The zip export failed.": { "Swedish": "Zip-exporten misslyckades." },
  "Export as .pdf": { "Swedish": "Exportera som .pdf" },
  "LaTeX project (.zip)": { "Swedish": "LaTeX-projekt (.zip)" },
  "PDF export": { "Swedish": "PDF-export" },
  "LaTeX project export": { "Swedish": "LaTeX-projektexport" },
  "The PDF export failed.": { "Swedish": "PDF-exporten misslyckades." },
  "The LaTeX export failed.": { "Swedish": "LaTeX-exporten misslyckades." },
  "Front page": { "Swedish": "Förstasida" },
  "Front title": { "Swedish": "Titel" },
  "Author": { "Swedish": "Författare" },
  "Document title": { "Swedish": "Dokumentets titel" },
  "Author name": { "Swedish": "Författarens namn" },
  "Front image": { "Swedish": "Bild på förstasidan" },
  "Choose image…": { "Swedish": "Välj bild…" },
  "Change image…": { "Swedish": "Byt bild…" },
  "No image": { "Swedish": "Ingen bild" },
  "Image opacity": { "Swedish": "Bildens opacitet" },
  "Front layout": { "Swedish": "Layout förstasida" },
  "Centered": { "Swedish": "Centrerad" },
  "Opposite corners": { "Swedish": "Motsatta hörn" },
  "Table of contents": { "Swedish": "Innehållsförteckning" },
  "Format": { "Swedish": "Format" },
  "Article (symmetric)": { "Swedish": "Artikel (symmetrisk)" },
  "Book (mirrored margins)": { "Swedish": "Bok (speglade marginaler)" },
  "Margins": { "Swedish": "Marginaler" },
  "Narrow": { "Swedish": "Smal" },
  "Normal": { "Swedish": "Normal" },
  "Wide": { "Swedish": "Bred" },
  "Font size": { "Swedish": "Teckenstorlek" },
  "Page size": { "Swedish": "Sidstorlek" },
  "Page numbers": { "Swedish": "Sidnummer" },
  "Engine": { "Swedish": "Motor" },
  "Template": { "Swedish": "Mall" },
  "Article": { "Swedish": "Artikel" },
  "Report": { "Swedish": "Rapport" },
  "Book": { "Swedish": "Bok" },
  "Book (Revery)": { "Swedish": "Bok (Revery)" },
  "Homework (Revery)": { "Swedish": "Inlämning (Revery)" },
  "Title page": { "Swedish": "Titelsida" },
  "Exports a zip project: main.tex + images/ folder.": { "Swedish": "Exporterar ett zip-projekt: main.tex + images/-mapp." },
  "Some templates require XeLaTeX.": { "Swedish": "Vissa mallar kräver XeLaTeX." },
  "Split sections": { "Swedish": "Dela upp sektioner" },
  "One file per H1": { "Swedish": "En fil per H1" },
  "One file per H1 and H2": { "Swedish": "En fil per H1 och H2" },
  "Cover image (full page)": { "Swedish": "Omslagsbild (hel sida)" },
  "Custom…": { "Swedish": "Anpassad…" },
  "New template…": { "Swedish": "Ny mall…" },
  "Custom font…": { "Swedish": "Eget typsnitt…" },
  "Font name": { "Swedish": "Typsnittsnamn" },
  "Choose font file…": { "Swedish": "Välj typsnittsfil…" },
  "Installed font name": { "Swedish": "Namn på installerat typsnitt" },
  "Add": { "Swedish": "Lägg till" },
  "Delete font": { "Swedish": "Radera typsnitt" },
  "Font name is required.": { "Swedish": "Typsnittsnamn krävs." },
  "Font name is too long.": { "Swedish": "Typsnittsnamnet är för långt." },
  "Too many custom fonts.": { "Swedish": "För många egna typsnitt." },
  "A font with this name already exists.": { "Swedish": "Ett typsnitt med det här namnet finns redan." },
  "Unsupported font file type.": { "Swedish": "Typsnittsfilens format stöds inte." },
  "The font file is too large.": { "Swedish": "Typsnittsfilen är för stor." },
  "Could not save font (storage full?).": { "Swedish": "Kunde inte spara typsnittet (lagringen full?)." },
  "Choose a font file or type an installed font name.": { "Swedish": "Välj en typsnittsfil eller skriv namnet på ett installerat typsnitt." },
  "Advanced Options": { "Swedish": "Avancerade alternativ" },
  "The PDF print window could not be opened. Close any open print window and try again.": { "Swedish": "PDF-utskriftsfönstret kunde inte öppnas. Stäng eventuella öppna utskriftsfönster och försök igen." },

  /* ── i18n audit fixes: keys the code already requests via t() ── */
  "Background opacity ▸": { "Swedish": "Bakgrundsopacitet ▸" },
  "Crash backup unavailable": { "Swedish": "Kraschsäkerhetskopiering otillgänglig" },
  "Custom image…": { "Swedish": "Egen bild…" },
  "Editor gradient bg": { "Swedish": "Gradient-bakgrund i redigeraren" },
  "For older machines: fewer disk writes, calmer rendering, no background image. Saves keep full crash-safety.": { "Swedish": "För äldre datorer: färre diskskrivningar, lugnare rendering, ingen bakgrundsbild. Sparandet behåller full kraschsäkerhet." },
  "Live Preview (experimental)": { "Swedish": "Live Preview (experimentell)" },
  "Name": { "Swedish": "Namn" },
  "No background": { "Swedish": "Ingen bakgrund" },
  "Remove custom image": { "Swedish": "Ta bort egen bild" },
  "Render formatting inside the editor; markdown symbols show on the line you are editing. Hides the side preview while active.": { "Swedish": "Renderar formatering direkt i redigeraren; markdown-symboler visas på raden du redigerar. Döljer sidoförhandsgranskningen när det är aktivt." },
  "Slow Hardware Mode": { "Swedish": "Långsam hårdvara-läge" },
  "Theme default": { "Swedish": "Temats standard" },

  /* ── i18n audit fixes: sidebar strings (file panel, dialogs, boxes) ── */
  "OK": { "Swedish": "OK" },
  "Open": { "Swedish": "Öppna" },
  "Rename": { "Swedish": "Byt namn" },
  "Delete": { "Swedish": "Radera" },
  "New File Here": { "Swedish": "Ny fil här" },
  "New Folder Here": { "Swedish": "Ny mapp här" },
  "Show in Explorer": { "Swedish": "Visa i filhanteraren" },
  "Rename {n} items…": { "Swedish": "Byt namn på {n} objekt…" },
  "Delete {n} items": { "Swedish": "Radera {n} objekt" },
  "Rename {n} items — enter a base name": { "Swedish": "Byt namn på {n} objekt — ange ett basnamn" },
  "(items will be named: name, name_2, name_3 …):": { "Swedish": "(objekten döps: namn, namn_2, namn_3 …):" },
  "New folder name:": { "Swedish": "Nytt mappnamn:" },
  "Rename \"{name}\" to:": { "Swedish": "Byt namn på \"{name}\" till:" },
  "Delete {n} item(s)": { "Swedish": "Radera {n} objekt" },
  "Permanently delete {n} item(s)?": { "Swedish": "Radera {n} objekt permanent?" },
  "This cannot be undone.": { "Swedish": "Detta kan inte ångras." },
  "Move to Trash": { "Swedish": "Flytta till papperskorgen" },
  "Delete Folder": { "Swedish": "Radera mapp" },
  "Delete File": { "Swedish": "Radera fil" },
  "Link Update": { "Swedish": "Länkuppdatering" },
  "{n} file(s) could not be updated (their links are unchanged):": { "Swedish": "{n} fil(er) kunde inte uppdateras (deras länkar är oförändrade):" },
  "Undo Failed Partially": { "Swedish": "Ångra misslyckades delvis" },
  "{n} item(s) could not be moved back:": { "Swedish": "{n} objekt kunde inte flyttas tillbaka:" },
  "Move Issues": { "Swedish": "Flyttproblem" },
  "{n} item(s) could not be moved:": { "Swedish": "{n} objekt kunde inte flyttas:" },
  "Open Failed": { "Swedish": "Kunde inte öppna" },
  "Could not read:": { "Swedish": "Kunde inte läsa:" },
  "No Folder Open": { "Swedish": "Ingen mapp öppen" },
  "Please open a project folder first.": { "Swedish": "Öppna en projektmapp först." },
  "Could Not Create File": { "Swedish": "Kunde inte skapa filen" },
  "The file could not be created.": { "Swedish": "Filen kunde inte skapas." },
  "Update {n} link(s) in {m} file(s) so they keep working?": { "Swedish": "Uppdatera {n} länk(ar) i {m} fil(er) så att de fortsätter fungera?" },
  "Update links": { "Swedish": "Uppdatera länkar" },
  "…and {n} more": { "Swedish": "…och {n} till" },
  "Rename Failed": { "Swedish": "Namnbyte misslyckades" },
  "Could not rename file to \"{name}\".": { "Swedish": "Kunde inte byta namn på filen till \"{name}\"." },
  "Save Failed": { "Swedish": "Sparande misslyckades" },
  "Could not write to:": { "Swedish": "Kunde inte skriva till:" },
  "A file could not be created to save your work.": { "Swedish": "En fil kunde inte skapas för att spara ditt arbete." },
  "Recent Projects": { "Swedish": "Senaste projekt" },
  "No recent projects yet": { "Swedish": "Inga projekt ännu" },
  "Manage Projects": { "Swedish": "Hantera projekt" },
  "Remove folders from the quick-switch list. No files are deleted.": { "Swedish": "Ta bort mappar från snabbväxlingslistan. Inga filer raderas." },
  "No projects in list": { "Swedish": "Inga projekt i listan" },
  "Remove": { "Swedish": "Ta bort" },
  "Remove from list (does not delete files)": { "Swedish": "Ta bort från listan (raderar inga filer)" },
  "Done": { "Swedish": "Klar" },
  "Browse for folder…": { "Swedish": "Bläddra efter mapp…" },
  "Manage projects…": { "Swedish": "Hantera projekt…" },
  "Folder": { "Swedish": "Mapp" },
  "Back": { "Swedish": "Tillbaka" },
  "Go up one level": { "Swedish": "Gå upp en nivå" },
  "Loading…": { "Swedish": "Laddar…" },
  "Empty folder": { "Swedish": "Tom mapp" },
  "Copy Issues": { "Swedish": "Kopieringsproblem" },
  "{n} file(s) could not be copied:": { "Swedish": "{n} fil(er) kunde inte kopieras:" },
  "{n} file(s) could not be added:": { "Swedish": "{n} fil(er) kunde inte läggas till:" },
  "Close (Escape)": { "Swedish": "Stäng (Escape)" },
  "Recovery Backup Files Found": { "Swedish": "Återställningskopior hittades" },
  "{n} backup file(s) from a previous interrupted save were found.": { "Swedish": "{n} säkerhetskopior från ett tidigare avbrutet sparande hittades." },
  "Search project (Ctrl+Shift+F)": { "Swedish": "Sök i projektet (Ctrl+Skift+F)" },
  "Minimize": { "Swedish": "Minimera" },
  "Maximize / Restore": { "Swedish": "Maximera / Återställ" },
  "Top bar logo position": { "Swedish": "Logotypens position i topplisten" },
  "Left corner": { "Swedish": "Vänstra hörnet" },
  "Template name": { "Swedish": "Mallnamn" },
  "Create": { "Swedish": "Skapa" },
  "Delete template": { "Swedish": "Radera mall" },
  "Template name is required.": { "Swedish": "Mallnamn krävs." },
  "Template name is too long.": { "Swedish": "Mallnamnet är för långt." },
  "Template content is too long.": { "Swedish": "Mallens innehåll är för långt." },
  "A template with this name already exists.": { "Swedish": "En mall med det här namnet finns redan." },
  "Too many custom templates.": { "Swedish": "För många egna mallar." },
  "Could not save template (storage full?).": { "Swedish": "Kunde inte spara mallen (lagringen full?)." },
  "Font": { "Swedish": "Typsnitt" },
  "Serif": { "Swedish": "Serif" },
  "Sans-serif": { "Swedish": "Sans-serif" },
  "Monospace": { "Swedish": "Monospace" },
  "Harald Text": { "Swedish": "Harald Text" },
  "Harald Mono": { "Swedish": "Harald Mono" },
  "New page before each H1": { "Swedish": "Ny sida före varje H1" },
  "New page before each H2": { "Swedish": "Ny sida före varje H2" },
  "The front page is never numbered. Page numbers work in the desktop app; in the browser/Tauri they follow the system print dialog.": { "Swedish": "Förstasidan numreras aldrig. Sidnummer fungerar i skrivbordsappen; i webbläsaren/Tauri följer de systemets utskriftsdialog." },
  "Contents": { "Swedish": "Innehåll" },
  "Add media": { "Swedish": "Lägg till media" },
  "Search project…": { "Swedish": "Sök i projektet…" },
  "Searching…": { "Swedish": "Söker…" },
  "No matches.": { "Swedish": "Inga träffar." },
  "Showing first": { "Swedish": "Visar de första" },
  "Save as...": { "Swedish": "Spara som..." },
  "Export as .md": { "Swedish": "Exportera som .md" },
  "Export as .txt": { "Swedish": "Exportera som .txt" },
  "Export as .html": { "Swedish": "Exportera som .html" },
  "Export as .tex": { "Swedish": "Exportera som .tex" },
  // Toolbar Menu & Context Menu
  "Cut (Marked)": { "Swedish": "Klipp (markerat)" },
  "Copy (Marked)": { "Swedish": "Kopiera (markerat)" },
  "Paste": { "Swedish": "Klistra in" },
  "Insert Date": { "Swedish": "Infoga datum" },
  "Ordered List (Marked)": { "Swedish": "Numrerad lista (markerad)" },
  "Unordered List (Marked)": { "Swedish": "Punktlista (markerad)" },
  "Clear Format (Marked)": { "Swedish": "Rensa formatering (markerad)" },
  "Bold (Ctrl+B)": { "Swedish": "Fet (Ctrl+B)" },
  "Italic (Ctrl+I)": { "Swedish": "Kursiv (Ctrl+I)" },
  "Heading": { "Swedish": "Rubrik" },
  "Strikethrough": { "Swedish": "Genomstruken" },
  "Code Block": { "Swedish": "Kodblock" },
  "Inline Code": { "Swedish": "Inline-kod" },
  "Link": { "Swedish": "Länk" },
  "Image": { "Swedish": "Bild" },
  "Task List": { "Swedish": "Att göra-lista" },
  "Horizontal Rule": { "Swedish": "Horisontell linje" },
  "Footnote": { "Swedish": "Fotnot" },
  "Copy MD": { "Swedish": "Kopiera MD" },
  "Insert YAML ▸": { "Swedish": "Infoga YAML ▸" },
  
  // Modals & UI Actions
  "Find…": { "Swedish": "Sök…" },
  "Replace…": { "Swedish": "Ersätt…" },
  "Find": { "Swedish": "Sök" },
  "Replace": { "Swedish": "Ersätt" },
  "All": { "Swedish": "Alla" },
  "Replace all": { "Swedish": "Ersätt alla" },
  "Close": { "Swedish": "Stäng" },
  "Save As": { "Swedish": "Spara som" },
  "Enter filename (will be saved as .md):": { "Swedish": "Ange filnamn (sparas som .md):" },
  "Save": { "Swedish": "Spara" },
  "Cancel": { "Swedish": "Avbryt" },
  "Insert Table": { "Swedish": "Infoga tabell" },
  "Rows:": { "Swedish": "Rader:" },
  "Columns:": { "Swedish": "Kolumner:" },
  "Rows": { "Swedish": "Rader" },
  "Columns": { "Swedish": "Kolumner" },
  "Insert": { "Swedish": "Infoga" },
  "No results": { "Swedish": "Inga träffar" },
  "Previous": { "Swedish": "Föregående" },
  "Next": { "Swedish": "Nästa" },
  
  // Word count & Status
  "word": { "Swedish": "ord" },
  "words": { "Swedish": "ord" },
  "File saved": { "Swedish": "Filen sparades" },
  "No headings": { "Swedish": "Inga rubriker" },
  "Properties": { "Swedish": "Egenskaper" },
  "Copy": { "Swedish": "Kopiera" },
  "Copied!": { "Swedish": "Kopierad!" },
  
  // Quit Modal
  "Quit Editor": { "Swedish": "Avsluta redigeraren" },
  "Do you want to export your current work before quitting? Unsaved text will be lost.": { "Swedish": "Vill du exportera ditt nuvarande arbete innan du avslutar? Osparad text kommer att förloras." },
  "Engine Stopped": { "Swedish": "Programmet avslutad" },
  "The editor engine has been safely shut down. What would you like to do next?": { "Swedish": "Redigeringsmotorn har stängts av på ett säkert sätt. Vad vill du göra härnäst?" },
  "Restart Editor": { "Swedish": "Starta om redigeraren" },
  "Total Factory Reset": { "Swedish": "Total återställning" },
  "Leave Site": { "Swedish": "Lämna sidan" },
  "Don't Save": { "Swedish": "Spara inte" },
  "Export & Continue": { "Swedish": "Exportera & Fortsätt" },
  "Don't Export": { "Swedish": "Exportera Inte" },
  "Total Reset": { "Swedish": "Total Återställning" },
  "Restart": { "Swedish": "Starta Om" },
  "Leave": { "Swedish": "Lämna" },
  

  // Sidebar / Folder navigator
  "Open project folder": { "Swedish": "Öppna projektmapp" },
  "Close project folder": { "Swedish": "Stäng projektmapp" },
  "Switch project…": { "Swedish": "Byt projekt…" },
  "Open folder…": { "Swedish": "Öppna mapp…" },
  "New .md file in root folder": { "Swedish": "Ny .md-fil i rotmappen" },
  "New folder in root folder": { "Swedish": "Ny mapp i rotmappen" },
  "Expand all folders": { "Swedish": "Expandera alla mappar" },
  "Collapse all folders": { "Swedish": "Komprimera alla mappar" },
  "Sort files…": { "Swedish": "Sortera filer…" },
  "Switch to card view": { "Swedish": "Byt till kortvy" },
  "Switch to list view": { "Swedish": "Byt till listvy" },
  "Smaller cards": { "Swedish": "Mindre kort" },
  "Larger cards": { "Swedish": "Större kort" },
  "No folder open": { "Swedish": "Ingen mapp öppen" },
  "Name A → Z": { "Swedish": "Namn A → Ö" },
  "Name Z → A": { "Swedish": "Namn Ö → A" },
  "Newest first": { "Swedish": "Nyast först" },
  "Oldest first": { "Swedish": "Äldst först" },
  "Modified": { "Swedish": "Ändrad" },
  "Created": { "Swedish": "Skapad" },



// New/Import Modal
  "Unsaved Changes": { "Swedish": "Osparade ändringar" },
  "Clear Editor": { "Swedish": "Töm redigeraren" },
  "Export your work using the \"Export .md\" button. Once the file is safely on your hard drive, click \"Clear Editor\" to proceed with the import.": { "Swedish": "Exportera ditt arbete med knappen \"Exportera .md\". När filen är säkert sparad på din hårddisk, klicka på \"Töm redigeraren\" för att fortsätta med importen." },
  "Export your work using the \"Export .md\" button. Once the file is safely on your hard drive, click \"Clear Editor\".": { "Swedish": "Exportera ditt arbete med knappen \"Exportera .md\". När filen är säkert sparad på din hårddisk, klicka på \"Töm redigeraren\"." },
  "Do you want to export your current work before starting a new file? If you don't export, your current text will be lost forever.": { "Swedish": "Vill du exportera ditt nuvarande arbete innan du påbörjar en ny fil? Om du inte exporterar kommer din nuvarande text att förloras för alltid." },
  "Do you want to export your current work before importing a new file? If you don't export, your current text will be lost forever.": { "Swedish": "Vill du exportera ditt nuvarande arbete innan du importerar en ny fil? Om du inte exporterar kommer din nuvarande text att förloras för alltid." },
  "Yes, Export": { "Swedish": "Ja, exportera" },
  "No, Delete it": { "Swedish": "Nej, radera den" },
  
  // Date modal
  "Select Date": { "Swedish": "Välj datum" },

// Logo Menu
  "About": { "Swedish": "Om" },
  "Legal": { "Swedish": "Juridiskt" },
  "User Guide": { "Swedish": "Användarhandbok" },
  "Quit / Exit": { "Swedish": "Avsluta" },

// Templates
  "Recipe": { "Swedish": "Recept" },
  "To do": { "Swedish": "Att göra" },
  "Workout program": { "Swedish": "Träningsprogram" },
  "Grocery list": { "Swedish": "Inköpslista" },
  "Blog Post": { "Swedish": "Blogginlägg" },
  "LLM Entry": { "Swedish": "LLM-inlägg" },

  // Submenu Formats & Fonts
  "Long Date": { "Swedish": "Långt datum" },
  "None  —  Title.md": { "Swedish": "Ingen  —  Titel.md" },
  "Date suffix  —  Title_YYYY-MM-DD": { "Swedish": "Datum-suffix  —  Titel_ÅÅÅÅ-MM-DD" },
  "Datetime suffix  —  Title_YYYY-MM-DD_HH-MM-SS": { "Swedish": "Datumtid-suffix  —  Titel_ÅÅÅÅ-MM-DD_TT-MM-SS" },
  "Time suffix  —  Title_HH-MM-SS": { "Swedish": "Tid-suffix  —  Titel_TT-MM-SS" },
  "Date prefix  —  YYYY-MM-DD_Title": { "Swedish": "Datum-prefix  —  ÅÅÅÅ-MM-DD_Titel" },
  "Compact prefix  —  YYYYMMDD_Title": { "Swedish": "Kompakt prefix  —  ÅÅÅÅMMDD_Titel" },
  "Harald Revery Font": { "Swedish": "Harald Revery Typsnitt" },
  "System Sans-Serif": { "Swedish": "System Sans-Serif" },
  "System Serif": { "Swedish": "System Serif" },
  "System Monospace": { "Swedish": "System Monospace" },
  "Arial": { "Swedish": "Arial" },
  "Times New Roman": { "Swedish": "Times New Roman" },
  "Courier New": { "Swedish": "Courier New" },

  // Tooltips & Hidden Elements
  "Harald Revery — Menu": { "Swedish": "Harald Revery — Meny" },
  "Match Case": { "Swedish": "Matcha gemener/versaler" },
  "Regular Expression": { "Swedish": "Reguljära uttryck" },
  "Previous match (Shift+Enter)": { "Swedish": "Föregående träff (Shift+Enter)" },
  "Next match (Enter)": { "Swedish": "Nästa träff (Enter)" },
  "Close (Escape)": { "Swedish": "Stäng (Escape)" },
  "Replace current match (Enter)": { "Swedish": "Ersätt aktuell träff (Enter)" },
  "Replace all matches": { "Swedish": "Ersätt alla träffar" }
};
window.uiTemplates = {
  legal: {
    English: `
      <section class="mod-mb-20">
        <h4 class="mod-h4">Ownership, Licensing &amp; Intellectual Property</h4>
        <p class="mod-p">Revery Notebook is designed, developed, and operated by <strong>Harald Mark Thirslund</strong>, Göteborg (Gothenburg), Sweden. Copyright © 2026 Harald Mark Thirslund.</p>
        <p class="mod-p"><strong>Source code:</strong> the application source code is licensed under the <strong>Apache License 2.0</strong> (see the LICENSE and NOTICE files in the source repository). You may use, modify, and redistribute the code under that license's terms.</p>
        <p class="mod-p"><strong>Brand assets are NOT covered by the Apache License.</strong> The following remain the exclusive intellectual property of Harald Mark Thirslund, protected under applicable Swedish, EU, and international copyright and trademark law:</p>
        <ul class="mod-ul">
          <li>The <strong>HaraldText</strong> and <strong>HaraldMono</strong> typefaces ("Harald Revery Font"), in every format.</li>
          <li>All logo graphics, background images, icon glyphs (including outlines embedded in source files), installer artwork, and other visual brand elements.</li>
          <li>All original written content published on haraldrevery.com.</li>
        </ul>
        <p class="mod-p-0">These assets may be kept and used, unmodified and in place, solely to build and run this software (including forks). Any other use — extraction, modification, standalone redistribution, or use in other projects or branding — is prohibited without prior written consent (contact@haraldrevery.com). Full terms: the LICENSE-ASSETS file in the source repository.</p>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-20">
        <h4 class="mod-h4">Terms of Use</h4>
        <p class="mod-p">By accessing or using Revery Notebook you agree to these terms. If you do not agree, please discontinue use immediately.</p>
        <ul class="mod-ul">
          <li>Revery Notebook is a personal productivity tool. You may use it for any lawful purpose.</li>
          <li>You are solely responsible for the content you create, store, or export using this application.</li>
          <li>You must not use this tool to create, store, or distribute unlawful, harmful, or infringing content.</li>
          <li>Harald Mark Thirslund reserves the right to modify or discontinue the service at any time without notice.</li>
        </ul>
        <p class="mod-p-0">These terms are governed by the laws of Sweden and, where applicable, the laws of the European Union.</p>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-20">
        <h4 class="mod-h4">Local Data Storage</h4>
        <p class="mod-p">Revery Notebook stores data <strong>exclusively on your own device</strong> using your browser's <code class="mod-mono-sm">localStorage</code> API. The following data is stored locally:</p>
        <ul class="mod-ul">
          <li><strong>Document content</strong> — the markdown text you are currently editing (key: <code class="mod-mono-sm">revery_md_autosave</code>).</li>
          <li><strong>Editor preferences</strong> — UI settings such as theme, layout, and font sizes (key: <code class="mod-mono-sm">revery_md_settings</code>).</li>
        </ul>
        <p class="mod-p"><strong>No data is ever transmitted to any server.</strong> Harald Mark Thirslund has no access to, and does not collect, any content you write in this editor.</p>
        <p class="mod-p-0">You can delete all locally stored data at any time by clearing your browser's site data for this domain, or by using the "Total Reset" option in the File menu.</p>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-20">
        <h4 class="mod-h4">Cookies &amp; Tracking</h4>
        <p class="mod-p">Revery Notebook does <strong>not</strong> use cookies, tracking pixels, analytics scripts, advertising networks, or any third-party data collection technology.</p>
        <p class="mod-p-0">No personal data is shared with or sold to any third party. No user profiling or behavioural tracking takes place.</p>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-20">
        <h4 class="mod-h4">Privacy Policy</h4>
        <p class="mod-p-sub">EU / EEA — General Data Protection Regulation (GDPR)</p>
        <p class="mod-p">Harald Mark Thirslund is the data controller under the GDPR (Regulation (EU) 2016/679). Because Revery Notebook processes no personal data on any server and collects no identifying information, the GDPR's data minimisation and purpose-limitation principles are satisfied by design. The only data processed is content you voluntarily create, which is stored solely in your own browser and never leaves your device. You may exercise your rights (access, erasure, portability, restriction, objection) by clearing your own browser storage. For questions, contact: <strong>contact@haraldrevery.com</strong>.</p>
        <p class="mod-p-sub">North America — CCPA &amp; Canadian Privacy Law</p>
        <p class="mod-p">Harald Mark Thirslund does not sell, rent, or trade any personal information. No personal information as defined under the California Consumer Privacy Act (CCPA / CPRA) or Canada's Personal Information Protection and Electronic Documents Act (PIPEDA) / Quebec Law 25 is collected via this application. California residents and Canadian residents therefore have no personal data held by Harald Mark Thirslund that is subject to access, deletion, or opt-out requests.</p>
        <p class="mod-p-sub">Australia — Privacy Act 1988 (Cth)</p>
        <p class="mod-p-0">Revery Notebook does not collect personal information as defined by the Australian Privacy Act 1988 and the Australian Privacy Principles (APPs). No personal information is held, used, or disclosed by Harald Mark Thirslund in connection with this application.</p>
        <p class="mod-p-0">Revery Notebook is not intended for use by children under the age of 13. By using this service, you represent that you are of legal age to form a binding contract.</p>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-20">
        <h4 class="mod-h4">Third-Party Library Licences</h4>
        <p class="mod-mb-10">Revery Notebook is built using the following open-source libraries. Each is used in unmodified or minified form and is subject to its respective licence:</p>
        <div class="mod-lib-wrap">
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>markdown-it</strong> v14 &nbsp;·&nbsp; <span class="mod-mono-08">MIT Licence</span></p>
            <p class="mod-p-0-082">Copyright © 2014 Vitaly Puzrin, Alex Kocharin. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to the following condition: the above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.</p>
          </div>
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>markdown-it-footnote</strong> v4 &nbsp;·&nbsp; <span class="mod-mono-08">MIT Licence</span></p>
            <p class="mod-p-0-082">Copyright © 2014 Vitaly Puzrin, Alex Kocharin. Same MIT Licence terms as markdown-it above apply. Source: github.com/markdown-it/markdown-it-footnote.</p>
          </div>
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>highlight.js</strong> &nbsp;·&nbsp; <span class="mod-mono-08">BSD 3-Clause Licence</span></p>
            <p class="mod-p-0-082">Copyright © 2006 Ivan Sagalaev. Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: (1) Redistributions of source code must retain the above copyright notice, this list of conditions, and the following disclaimer. (2) Redistributions in binary form must reproduce the above copyright notice, this list of conditions, and the following disclaimer in the documentation and/or other materials provided with the distribution. (3) Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.</p>
          </div>
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>KaTeX</strong> &nbsp;·&nbsp; <span class="mod-mono-08">MIT Licence</span></p>
            <p class="mod-p-0-082">Copyright © 2013–2020 Khan Academy and other contributors. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to the following condition: the above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.</p>
          </div>
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>markdown-it-texmath</strong> (texmath.js) v1.0 &nbsp;·&nbsp; <span class="mod-mono-08">MIT Licence</span></p>
            <p class="mod-p-0-082">Copyright © 2013–2017 Stefan Goessner. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to the following condition: the above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. Source: github.com/goessner/markdown-it-texmath.</p>
          </div>
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>CodeMirror</strong> v6 &nbsp;·&nbsp; <span class="mod-mono-08">MIT Licence</span></p>
            <p class="mod-p-0-082">Copyright © 2018–2024 Marijn Haverbeke and contributors. Used packages: @codemirror/view, @codemirror/state, @codemirror/commands, @codemirror/lang-markdown, @codemirror/language. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to the following condition: the above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. Source: codemirror.net.</p>
          </div>
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>DOMPurify</strong> &nbsp;·&nbsp; <span class="mod-mono-08">Apache Licence 2.0</span></p>
            <p class="mod-p-0-082">Copyright © 2025 Dr.-Ing. Mario Heiderich, Cure53. Source: github.com/cure53/DOMPurify.</p>
            <details class="mod-license-details">
              <summary class="mod-license-summary">Apache License 2.0 — Full Text</summary>
              <pre class="mod-license-pre">Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction,
and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the
copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other
entities that control, are controlled by, or are under common control
with that entity. For the purposes of this definition, "control" means
(i) the power, direct or indirect, to cause the direction or management
of such entity, whether by contract or otherwise, or (ii) ownership of
fifty percent (50%) or more of the outstanding shares, or (iii)
beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising
permissions granted by this License.

"Source" form shall mean the preferred form for making modifications,
including but not limited to software source code, documentation source,
and configuration files.

"Object" form shall mean any form resulting from mechanical transformation
or translation of a Source form, including but not limited to compiled
object code, generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship made available under the License,
as indicated by a copyright notice that is included in or attached to the
work (an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object form,
that is based on (or derived from) the Work and for which the editorial
revisions, annotations, elaborations, or other modifications represent,
as a whole, an original work of authorship. For the purposes of this
License, Derivative Works shall not include works that remain separable
from, or merely link (or bind by name) to the interfaces of, the Work
and Derivative Works thereof.

"Contribution" shall mean, as submitted to the Licensor for inclusion in
the Work by the copyright owner or by an individual or Legal Entity
authorized to submit on behalf of the copyright owner. For the purposes
of this definition, "submitted" means any form of electronic, verbal, or
written communication sent to the Licensor or its representatives,
including but not limited to communication on electronic mailing lists,
source code control systems, and issue tracking systems that are managed
by, or on behalf of, the Licensor for the purpose of discussing and
improving the Work, but excluding communication that is conspicuously
marked or otherwise designated in writing by the copyright owner as "Not
a Contribution."

"Contributor" shall mean Licensor and any Legal Entity on behalf of whom
a Contribution has been received by the Licensor and subsequently
incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
this License, each Contributor hereby grants to You a perpetual,
worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright
license to reproduce, prepare Derivative Works of, publicly display,
publicly perform, sublicense, and distribute the Work and such Derivative
Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of this
License, each Contributor hereby grants to You a perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable (except as stated in
this section) patent license to make, have made, use, offer to sell, sell,
import, and otherwise transfer the Work, where such license applies only
to those patent claims licensable by such Contributor that are necessarily
infringed by their Contribution(s) alone or by combination of their
Contribution(s) with the Work to which such Contribution(s) was submitted.
If You institute patent litigation against any entity (including a
cross-claim or counterclaim in a lawsuit) alleging that the Work or a
Contribution incorporated within the Work constitutes direct or
contributory patent infringement, then any patent licenses granted to You
under this License for that Work shall terminate as of the date such
litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the Work or
Derivative Works thereof in any medium, with or without modifications, and
in Source or Object form, provided that You meet the following conditions:

  (a) You must give any other recipients of the Work or Derivative Works
      a copy of this License; and

  (b) You must cause any modified files to carry prominent notices stating
      that You changed the files; and

  (c) You must retain, in the Source form of any Derivative Works that You
      distribute, all copyright, patent, trademark, and attribution notices
      from the Source form of the Work, excluding those notices that do not
      pertain to any part of the Derivative Works; and

  (d) If the Work includes a "NOTICE" text file as part of its distribution,
      You must include a readable copy of the attribution notices contained
      within such NOTICE file, in at least one of the following places:
      within a NOTICE text displayed as part of the Derivative Works; within
      the Source form or documentation, if provided along with the Derivative
      Works; or, within a display generated by the Derivative Works, if and
      wherever such third-party notices normally appear. The contents of the
      NOTICE file are for informational purposes only and do not modify the
      License. You may add Your own attribution notices within Derivative
      Works that You distribute, alongside or as an addendum to the NOTICE
      text from the Work, provided that such additional attribution notices
      cannot be construed as modifying the License.

  You may add Your own license statement for Your modifications and may
  provide additional grant of rights to use, reproduce, modify, prepare
  Derivative Works of, publicly display, publicly perform, sublicense, and
  distribute those Derivative Works and such modifications.

5. Submission of Contributions. Unless You explicitly state otherwise, any
Contribution intentionally submitted for inclusion in the Work by You to
the Licensor shall be under the terms and conditions of this License,
without any additional terms or conditions. Notwithstanding the above,
nothing herein shall supersede or modify the terms of any separate license
agreement you may have executed with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
names, trademarks, service marks, or product names of the Licensor, except
as required for reasonable and customary use in describing the origin of
the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or agreed to
in writing, Licensor provides the Work (and each Contributor provides its
Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
ANY KIND, either express or implied, including, without limitation, any
warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or
FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for
determining the appropriateness of using or redistributing the Work and
assume any risks associated with Your exercise of permissions under this
License.

8. Limitation of Liability. In no event and under no legal theory, whether
in tort (including negligence), contract, or otherwise, unless required by
applicable law (such as deliberate and grossly negligent acts) or agreed to
in writing, shall any Contributor be liable to You for damages, including
any direct, indirect, special, incidental, or exemplary damages of any
character arising as a result of this License or out of the use or
inability to use the Work (including but not limited to damages for loss of
goodwill, work stoppage, computer failure or malfunction, or all other
commercial damages or losses), even if such Contributor has been advised
of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing the
Work or Derivative Works thereof, You may choose to offer, and charge a
fee for, acceptance of support, warranty, indemnity, or other liability
obligations and/or rights consistent with this License. However, in
accepting such obligations, You may act only on Your own behalf and on
Your sole responsibility, not on behalf of any other Contributor, and only
if You agree to indemnify, defend, and hold each Contributor harmless for
any liability incurred by, or claims asserted against, such Contributor by
reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS</pre>
            </details>
          </div>
        </div>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-20">
        <h4 class="mod-h4">Disclaimer of Liability</h4>
        <p class="mod-p">REVERY NOTEBOOK IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.</p>
        <p class="mod-p">TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, HARALD MARK THIRSLUND SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION ANY LOSS OF DATA, LOSS OF PROFITS, OR BUSINESS INTERRUPTION, HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT, ARISING IN ANY WAY OUT OF THE USE OF OR INABILITY TO USE THIS APPLICATION.</p>
        <p class="mod-p-0"><strong>Important:</strong> Because your documents are stored solely in your browser's localStorage, data may be lost if you clear your browser data, switch browsers, use private/incognito mode, or if your browser storage quota is exceeded. <strong>Always export your work regularly.</strong></p>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-4">
        <h4 class="mod-h4">Changes to This Notice</h4>
        <p class="mod-p">Harald Mark Thirslund may update this legal notice from time to time. Material changes will be indicated by an updated date in the application. Continued use of Revery Notebook after any changes constitutes acceptance of the revised notice.</p>
        <p class="mod-p-last">Last updated: April 2026 &nbsp;·&nbsp; Harald Mark Thirslund, Göteborg, Sweden</p>
      </section>
    `,
    Swedish: `
      <section class="mod-mb-20">
        <h4 class="mod-h4">Äganderätt &amp; immateriella rättigheter</h4>
        <p class="mod-p">Revery Notebook är designad, utvecklad och drivs av <strong>Harald Mark Thirslund</strong>, Göteborg, Sverige. Copyright © 2026 Harald Mark Thirslund.</p>
        <p class="mod-p"><strong>Källkod:</strong> applikationens källkod är licensierad under <strong>Apache License 2.0</strong> (se filerna LICENSE och NOTICE i källkodsförrådet). Du får använda, ändra och vidaredistribuera koden enligt den licensens villkor.</p>
        <p class="mod-p"><strong>Varumärkestillgångarna omfattas INTE av Apache-licensen.</strong> Följande förblir Harald Mark Thirslunds exklusiva immateriella egendom och skyddas enligt tillämplig svensk, EU-rättslig och internationell upphovsrätt och varumärkesrätt:</p>
        <ul class="mod-ul">
          <li>Typsnitten <strong>HaraldText</strong> och <strong>HaraldMono</strong> ("Harald Revery typsnitt"), i alla format.</li>
          <li>Alla logotyper, bakgrundsbilder, ikonglyfer (inklusive konturer inbäddade i källkodsfiler), installationsprogrammets grafik och övriga visuella varumärkeselement.</li>
          <li>Allt originalt skrivet innehåll publicerat på haraldrevery.com.</li>
        </ul>
        <p class="mod-p-0">Dessa tillgångar får behållas och användas, oförändrade och på plats, enbart för att bygga och köra denna programvara (inklusive förgreningar). All annan användning — extrahering, ändring, separat vidaredistribution eller användning i andra projekt eller varumärken — är förbjuden utan föregående skriftligt medgivande (contact@haraldrevery.com). Fullständiga villkor: filen LICENSE-ASSETS i källkodsförrådet.</p>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-20">
        <h4 class="mod-h4">Användarvillkor</h4>
        <p class="mod-p">Genom att använda Revery Notebook godkänner du dessa villkor. Om du inte godkänner dem, vänligen sluta använda tjänsten omedelbart.</p>
        <ul class="mod-ul">
          <li>Revery Notebook är ett personligt produktivitetsverktyg. Du får använda det för alla lagliga ändamål.</li>
          <li>Du är ensamt ansvarig för det innehåll du skapar, lagrar eller exporterar med hjälp av denna applikation.</li>
          <li>Du får inte använda detta verktyg för att skapa, lagra eller distribuera olagligt, skadligt eller intrångsgörande innehåll.</li>
          <li>Harald Mark Thirslund förbehåller sig rätten att ändra eller avveckla tjänsten när som helst utan föregående meddelande.</li>
        </ul>
        <p class="mod-p-0">Dessa villkor regleras av svensk lag och, i tillämpliga fall, av Europeiska unionens lagstiftning.</p>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-20">
        <h4 class="mod-h4">Lokal datalagring</h4>
        <p class="mod-p">Revery Notebook lagrar data <strong>uteslutande på din egen enhet</strong> med hjälp av webbläsarens <code class="mod-mono-sm">localStorage</code>-API. Följande data lagras lokalt:</p>
        <ul class="mod-ul">
          <li><strong>Dokumentinnehåll</strong> — markdowntexten du redigerar (nyckel: <code class="mod-mono-sm">revery_md_autosave</code>).</li>
          <li><strong>Editorinställningar</strong> — gränssnittsinställningar som tema, layout och teckenstorlekar (nyckel: <code class="mod-mono-sm">revery_md_settings</code>).</li>
        </ul>
        <p class="mod-p"><strong>Ingen data skickas någonsin till någon server.</strong> Harald Mark Thirslund har inte tillgång till, och samlar inte in, något innehåll du skriver i denna editor.</p>
        <p class="mod-p-0">Du kan radera all lokalt lagrad data när som helst genom att rensa webbläsarens webbplatsdata för denna domän, eller genom att använda alternativet "Total återställning" i Fil-menyn.</p>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-20">
        <h4 class="mod-h4">Cookies &amp; spårning</h4>
        <p class="mod-p">Revery Notebook använder <strong>inte</strong> cookies, spårningspixlar, analysskript, annonsnätverk eller någon annan datainsamlingsteknik från tredje part.</p>
        <p class="mod-p-0">Ingen personlig data delas med eller säljs till någon tredje part. Ingen användarprofileringseller beteendespårning sker.</p>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-20">
        <h4 class="mod-h4">Integritetspolicy</h4>
        <p class="mod-p-sub">EU / EES — Allmän dataskyddsförordningen (GDPR)</p>
        <p class="mod-p">Harald Mark Thirslund är personuppgiftsansvarig enligt GDPR (förordning (EU) 2016/679). Eftersom Revery Notebook inte behandlar personuppgifter på någon server och inte samlar in identifierande information uppfylls GDPR:s principer om uppgiftsminimering och ändamålsbegränsning redan av design. Den enda data som behandlas är innehåll du frivilligt skapar, vilket lagras uteslutande i din webbläsare och aldrig lämnar din enhet. Du kan utöva dina rättigheter (tillgång, radering, portabilitet, begränsning, invändning) genom att rensa din egen webbläsarlagring. För frågor, kontakta: <strong>contact@haraldrevery.com</strong>.</p>
        <p class="mod-p-sub">Nordamerika — CCPA &amp; kanadensisk integritetslagstiftning</p>
        <p class="mod-p">Harald Mark Thirslund säljer, hyr ut eller handlar inte med någon personlig information. Ingen personlig information enligt definitionen i Californias Consumer Privacy Act (CCPA/CPRA) eller Kanadas Personal Information Protection and Electronic Documents Act (PIPEDA) / Quebecs Lag 25 samlas in via denna applikation.</p>
        <p class="mod-p-sub">Australien — Privacy Act 1988 (Cth)</p>
        <p class="mod-p">Revery Notebook samlar inte in personlig information enligt definitionen i den australiska Privacy Act 1988 och de australiska integritetsprinciperna (APPs).</p>
        <p class="mod-p-0">Revery Notebook är inte avsett för barn under 13 år. Genom att använda tjänsten bekräftar du att du är myndig (över 18 år), eller har målsmans godkännande, för att ingå ett bindande avtal.</p>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-20">
        <h4 class="mod-h4">Licenser för tredjepartsbibliotek</h4>
        <p class="mod-mb-10">Revery Notebook är byggt med följande bibliotek med öppen källkod, vart och ett licensierat enligt sina respektive villkor:</p>
        <div class="mod-lib-wrap">
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>markdown-it</strong> v14 &nbsp;·&nbsp; <span class="mod-mono-08">MIT-licens</span></p>
            <p class="mod-p-0-082">Copyright © 2014 Vitaly Puzrin, Alex Kocharin. Tillstånd beviljas härmed, utan kostnad, till varje person som erhåller en kopia av denna programvara att använda, kopiera, modifiera, slå samman, publicera, distribuera, underlicensiera och/eller sälja kopior av programvaran, förutsatt att ovanstående upphovsrättsmeddelande och detta tillståndsmeddelande ingår i alla kopior. PROGRAMVARAN TILLHANDAHÅLLS "I BEFINTLIGT SKICK", UTAN GARANTI AV NÅGOT SLAG.</p>
          </div>
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>markdown-it-footnote</strong> v4 &nbsp;·&nbsp; <span class="mod-mono-08">MIT-licens</span></p>
            <p class="mod-p-0-082">Copyright © 2014 Vitaly Puzrin, Alex Kocharin. Samma MIT-licensvillkor som ovan gäller.</p>
          </div>
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>highlight.js</strong> &nbsp;·&nbsp; <span class="mod-mono-08">BSD 3-klausuls licens</span></p>
            <p class="mod-p-0-082">Copyright © 2006 Ivan Sagalaev. Vidaredistribution och användning i käll- och binärform, med eller utan modifiering, är tillåten förutsatt att: (1) källkodsdistributioner behåller ovanstående upphovsrättsmeddelande; (2) binära distributioner reproducerar upphovsrättsmeddelandet i dokumentationen; (3) varken upphovsrättsinnehavarens namn eller bidragsgivarnas namn används för att marknadsföra produkter utan specifikt skriftligt tillstånd. PROGRAMVARAN TILLHANDAHÅLLS "I BEFINTLIGT SKICK" UTAN GARANTIER AV NÅGOT SLAG.</p>
          </div>
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>KaTeX</strong> &nbsp;·&nbsp; <span class="mod-mono-08">MIT-licens</span></p>
            <p class="mod-p-0-082">Copyright © 2013–2020 Khan Academy och övriga bidragsgivare. Samma MIT-licensvillkor som ovan gäller.</p>
          </div>
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>markdown-it-texmath</strong> (texmath.js) v1.0 &nbsp;·&nbsp; <span class="mod-mono-08">MIT-licens</span></p>
            <p class="mod-p-0-082">Copyright © 2013–2017 Stefan Goessner. Samma MIT-licensvillkor som ovan gäller.</p>
          </div>
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>CodeMirror</strong> v6 &nbsp;·&nbsp; <span class="mod-mono-08">MIT-licens</span></p>
            <p class="mod-p-0-082">Copyright © 2018–2024 Marijn Haverbeke och bidragsgivare. Använda paket: @codemirror/view, @codemirror/state, @codemirror/commands, @codemirror/lang-markdown, @codemirror/language. Samma MIT-licensvillkor som ovan gäller. Källa: codemirror.net.</p>
          </div>
          <div class="mod-lib-card">
            <p class="mod-p-4"><strong>DOMPurify</strong> &nbsp;·&nbsp; <span class="mod-mono-08">Apache-licens 2.0</span></p>
            <p class="mod-p-0-082">Copyright © 2025 Dr.-Ing. Mario Heiderich, Cure53. Källa: github.com/cure53/DOMPurify.</p>
            <details class="mod-license-details">
              <summary class="mod-license-summary">Apache License 2.0 — Fullständig text</summary>
              <pre class="mod-license-pre">Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction,
and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the
copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other
entities that control, are controlled by, or are under common control
with that entity. For the purposes of this definition, "control" means
(i) the power, direct or indirect, to cause the direction or management
of such entity, whether by contract or otherwise, or (ii) ownership of
fifty percent (50%) or more of the outstanding shares, or (iii)
beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising
permissions granted by this License.

"Source" form shall mean the preferred form for making modifications,
including but not limited to software source code, documentation source,
and configuration files.

"Object" form shall mean any form resulting from mechanical transformation
or translation of a Source form, including but not limited to compiled
object code, generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship made available under the License,
as indicated by a copyright notice that is included in or attached to the
work (an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object form,
that is based on (or derived from) the Work and for which the editorial
revisions, annotations, elaborations, or other modifications represent,
as a whole, an original work of authorship. For the purposes of this
License, Derivative Works shall not include works that remain separable
from, or merely link (or bind by name) to the interfaces of, the Work
and Derivative Works thereof.

"Contribution" shall mean, as submitted to the Licensor for inclusion in
the Work by the copyright owner or by an individual or Legal Entity
authorized to submit on behalf of the copyright owner. For the purposes
of this definition, "submitted" means any form of electronic, verbal, or
written communication sent to the Licensor or its representatives,
including but not limited to communication on electronic mailing lists,
source code control systems, and issue tracking systems that are managed
by, or on behalf of, the Licensor for the purpose of discussing and
improving the Work, but excluding communication that is conspicuously
marked or otherwise designated in writing by the copyright owner as "Not
a Contribution."

"Contributor" shall mean Licensor and any Legal Entity on behalf of whom
a Contribution has been received by the Licensor and subsequently
incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
this License, each Contributor hereby grants to You a perpetual,
worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright
license to reproduce, prepare Derivative Works of, publicly display,
publicly perform, sublicense, and distribute the Work and such Derivative
Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of this
License, each Contributor hereby grants to You a perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable (except as stated in
this section) patent license to make, have made, use, offer to sell, sell,
import, and otherwise transfer the Work, where such license applies only
to those patent claims licensable by such Contributor that are necessarily
infringed by their Contribution(s) alone or by combination of their
Contribution(s) with the Work to which such Contribution(s) was submitted.
If You institute patent litigation against any entity (including a
cross-claim or counterclaim in a lawsuit) alleging that the Work or a
Contribution incorporated within the Work constitutes direct or
contributory patent infringement, then any patent licenses granted to You
under this License for that Work shall terminate as of the date such
litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the Work or
Derivative Works thereof in any medium, with or without modifications, and
in Source or Object form, provided that You meet the following conditions:

  (a) You must give any other recipients of the Work or Derivative Works
      a copy of this License; and

  (b) You must cause any modified files to carry prominent notices stating
      that You changed the files; and

  (c) You must retain, in the Source form of any Derivative Works that You
      distribute, all copyright, patent, trademark, and attribution notices
      from the Source form of the Work, excluding those notices that do not
      pertain to any part of the Derivative Works; and

  (d) If the Work includes a "NOTICE" text file as part of its distribution,
      You must include a readable copy of the attribution notices contained
      within such NOTICE file, in at least one of the following places:
      within a NOTICE text displayed as part of the Derivative Works; within
      the Source form or documentation, if provided along with the Derivative
      Works; or, within a display generated by the Derivative Works, if and
      wherever such third-party notices normally appear. The contents of the
      NOTICE file are for informational purposes only and do not modify the
      License. You may add Your own attribution notices within Derivative
      Works that You distribute, alongside or as an addendum to the NOTICE
      text from the Work, provided that such additional attribution notices
      cannot be construed as modifying the License.

  You may add Your own license statement for Your modifications and may
  provide additional grant of rights to use, reproduce, modify, prepare
  Derivative Works of, publicly display, publicly perform, sublicense, and
  distribute those Derivative Works and such modifications.

5. Submission of Contributions. Unless You explicitly state otherwise, any
Contribution intentionally submitted for inclusion in the Work by You to
the Licensor shall be under the terms and conditions of this License,
without any additional terms or conditions. Notwithstanding the above,
nothing herein shall supersede or modify the terms of any separate license
agreement you may have executed with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
names, trademarks, service marks, or product names of the Licensor, except
as required for reasonable and customary use in describing the origin of
the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or agreed to
in writing, Licensor provides the Work (and each Contributor provides its
Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
ANY KIND, either express or implied, including, without limitation, any
warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or
FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for
determining the appropriateness of using or redistributing the Work and
assume any risks associated with Your exercise of permissions under this
License.

8. Limitation of Liability. In no event and under no legal theory, whether
in tort (including negligence), contract, or otherwise, unless required by
applicable law (such as deliberate and grossly negligent acts) or agreed to
in writing, shall any Contributor be liable to You for damages, including
any direct, indirect, special, incidental, or exemplary damages of any
character arising as a result of this License or out of the use or
inability to use the Work (including but not limited to damages for loss of
goodwill, work stoppage, computer failure or malfunction, or all other
commercial damages or losses), even if such Contributor has been advised
of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing the
Work or Derivative Works thereof, You may choose to offer, and charge a
fee for, acceptance of support, warranty, indemnity, or other liability
obligations and/or rights consistent with this License. However, in
accepting such obligations, You may act only on Your own behalf and on
Your sole responsibility, not on behalf of any other Contributor, and only
if You agree to indemnify, defend, and hold each Contributor harmless for
any liability incurred by, or claims asserted against, such Contributor by
reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS</pre>
            </details>
          </div>
        </div>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-20">
        <h4 class="mod-h4">Ansvarsbegränsning</h4>
        <p class="mod-p">REVERY NOTEBOOK TILLHANDAHÅLLS "I BEFINTLIGT SKICK" OCH "TILLGÄNGLIGT SOM DET ÄR", UTAN GARANTI AV NÅGOT SLAG, UTTRYCKLIG ELLER UNDERFÖRSTÅDD, INKLUSIVE MEN INTE BEGRÄNSAT TILL GARANTIER OM SÄLJBARHET, LÄMPLIGHET FÖR ETT VISST ÄNDAMÅL OCH ICKE-INTRÅNG.</p>
        <p class="mod-p">I DEN UTSTRÄCKNING SOM TILLÄMPLIG LAG TILLÅTER SKALL HARALD MARK THIRSLUND INTE VARA ANSVARIG FÖR INDIREKTA, OAVSIKTLIGA, SÄRSKILDA, FÖLJDRIKTIGA ELLER STRAFFBARA SKADOR, INKLUSIVE UTAN BEGRÄNSNING DATAFÖRLUST, UTEBLIVEN VINST ELLER AFFÄRSAVBROTT.</p>
        <p class="mod-p-0"><strong>Viktigt:</strong> Eftersom dina dokument lagras uteslutande i webbläsarens localStorage kan data gå förlorad om du rensar webbläsardata, byter webbläsare, använder privat/incognito-läge eller om webbläsarens lagringskvot överskrids. <strong>Exportera alltid ditt arbete regelbundet.</strong></p>
      </section>
      <hr class="mod-hr">

      <section class="mod-mb-4">
        <h4 class="mod-h4">Ändringar av detta meddelande</h4>
        <p class="mod-p">Harald Mark Thirslund kan komma att uppdatera detta juridiska meddelande från tid till annan. Väsentliga ändringar indikeras av ett uppdaterat datum i applikationen. Fortsatt användning av Revery Notebook efter eventuella ändringar innebär att du godkänner det reviderade meddelandet.</p>
        <p class="mod-p-last">Senast uppdaterad: april 2026 &nbsp;·&nbsp; Harald Mark Thirslund, Göteborg, Sverige</p>
      </section>
    `
  },

  about: {
    English: `
      <section class="mod-mb-20">
        <h4 class="mod-about-title">½</h4>
        <p class="mod-p">A markdown editor with my brand aesthetics. Simple and just works. LaTeX math, live preview, project folders on desktop, and PDF/LaTeX/zip export.</p>
      </section>
      <hr class="mod-hr">
      <section class="mod-mb-20">
        <h4 class="mod-about-title">Version Info</h4>
        <ul class="mod-list-none">
          <li><span class="mod-mono">v1.0.0</span> — Stable</li>
          <li><span class="mod-mono">Build:</span> July 2026</li>
        </ul>
      </section>
      <hr class="mod-hr">
      <section class="mod-mb-20">
        <h4 class="mod-about-title">Safety by design</h4>
        <ul class="mod-list-none">
          <li>Auto-save writes files atomically — a crash mid-save can never corrupt your document.</li>
          <li>A crash backup of your typing is kept while you write; recovery is offered on the next start.</li>
          <li>Renaming or moving files keeps the links in your notes working (with your confirmation).</li>
          <li>The app never opens links and never acts as a browser.</li>
          <li>Only one instance runs at a time, so saves never compete for the same file.</li>
        </ul>
      </section>
      <hr class="mod-hr">
      <section class="mod-mb-20">
        <h4 class="mod-about-title">Copyright &amp; License</h4>
        <p class="mod-p-0">© 2026 Harald Mark Thirslund, Sweden. The source code is licensed under Apache License 2.0; the fonts, images, logo and icons are proprietary — see the Legal page for details.</p>
      </section>
      <hr class="mod-hr">
    `,
    Swedish: `
      <section class="mod-mb-20">
        <h4 class="mod-about-title">½</h4>
        <p class="mod-p">En markdownredigerare med min varumärkesestetik. Enkel och fungerar bara. LaTeX-matematik, live preview, projektmappar på skrivbordet och PDF-/LaTeX-/zip-export.</p>
      </section>
      <hr class="mod-hr">
      <section class="mod-mb-20">
        <h4 class="mod-about-title">Versionsinfo</h4>
        <ul class="mod-list-none">
          <li><span class="mod-mono">v1.0.0</span> — Stabil</li>
          <li><span class="mod-mono">Bygg:</span> Juli 2026</li>
        </ul>
      </section>
      <hr class="mod-hr">
      <section class="mod-mb-20">
        <h4 class="mod-about-title">Säkerhet i grunden</h4>
        <ul class="mod-list-none">
          <li>Autospar skriver filer atomiskt — en krasch mitt i en sparning kan aldrig förstöra ditt dokument.</li>
          <li>En kraschsäkerhetskopia av det du skriver sparas löpande; återställning erbjuds vid nästa start.</li>
          <li>När filer byter namn eller flyttas hålls länkarna i dina anteckningar fungerande (efter din bekräftelse).</li>
          <li>Appen öppnar aldrig länkar och agerar aldrig webbläsare.</li>
          <li>Endast en instans körs åt gången, så sparningar konkurrerar aldrig om samma fil.</li>
        </ul>
      </section>
      <hr class="mod-hr">
      <section class="mod-mb-20">
        <h4 class="mod-about-title">Upphovsrätt &amp; licens</h4>
        <p class="mod-p-0">© 2026 Harald Mark Thirslund, Sverige. Källkoden är licensierad under Apache License 2.0; typsnitten, bilderna, logotypen och ikonerna är upphovsrättsskyddade — se sidan Juridiskt för detaljer.</p>
      </section>
      <hr class="mod-hr">
    `
  },

  userGuide: {
    English: `
      <section class="mod-mb-20">
        <h4 class="mod-guide-h4">Keyboard Shortcuts</h4>
        <table class="mod-table">
          <tbody>
            <tr><td class="mod-td-w52">Ctrl + F</td><td class="mod-td">Open Find / Replace</td></tr>
            <tr><td class="mod-td-w52">Ctrl + Z</td><td class="mod-td">Undo (outside the editor: undoes the last file move/rename)</td></tr>
            <tr><td class="mod-td-w52">Ctrl + Y</td><td class="mod-td">Redo</td></tr>
            <tr><td class="mod-td-w52">Ctrl + S</td><td class="mod-td">Export / Save file</td></tr>
            <tr><td class="mod-td-w52">Tab (in editor)</td><td class="mod-td">Insert 4 spaces</td></tr>
          </tbody>
        </table>
      </section>
      <hr class="mod-guide-hr">
      <section class="mod-mb-20">
        <h4 class="mod-guide-h4">Settings Tips</h4>
        <ul class="mod-guide-ul">
          <li><strong>Show Preview</strong> — toggle the live rendered preview on or off. Hiding it gives you a full-width editor.</li>
          <li><strong>Show Outline</strong> — opens a heading navigator panel on the right. Click any heading to jump to it.</li>
          <li><strong>Reader Mode</strong> — hides the editor entirely for a clean, distraction-free reading view. Press <em>Exit Reader Mode</em> to return.</li>
          <li><strong>Mobile View</strong> — frames the preview at a phone-sized width so you can see how your content looks on small screens (don't rely on this too much...).</li>
          <li><strong>UI Size / Text Size</strong> — "UI Size" scales menu buttons; "Text Size" scales editor and preview text.</li>
          <li><strong>Calendar Format</strong> (Settings menu) — choose how dates are inserted when you use the date toolbar action.</li>
          <li><strong>Drag the divider</strong> — the vertical bar between editor and preview can be dragged left or right to resize each pane.</li>
          <li><strong>Click any preview block</strong> — jumps the editor cursor to the matching source line.</li>
          <li><strong>CPU performance delay</strong> — Higher value = Saves battery and CPU, but not that great experience. Low value = drains more CPU and battery but smoother experience.</li>
          <li><strong>Forced Prev. Synch.</strong> — "Forced Preview Synchronization" is a more reliable synchronization between the editor and preview window, but might feel a little janky. Use if you notice that the what you type is not visible on the preview.</li>
          <li><strong>Slow Hardware Mode</strong> — one switch for older machines: fewer disk writes while typing, calmer preview rendering, no background image, and lighter file cards. Saving stays exactly as crash-safe as before.</li>
          <li><strong>Background &amp; opacity</strong> — pick one of the built-in preview backgrounds, turn it off, or import your own image (kept locally and downscaled automatically). "Background opacity" tunes how strongly it shows through.</li>
          <li><strong>Live Preview (experimental)</strong> — renders your document directly in the editor through the same renderer as the preview pane, so everything looks identical: typography, headings, quotes, lists, images, tables, LaTeX math (including multi-line $$…$$) and colored code blocks. The block you are editing shows its raw markdown; click any rendered block to edit it. Your file on disk always stays plain markdown.</li>
          <li><strong>Zip Project Export</strong> (desktop) — File menu → Zip Project Export saves your whole project folder as a .zip archive wherever you choose. Great for backups before big rewrites. The archive is written safely (never half-finished) and is not password protected — use encrypted storage if your notes are sensitive.</li>
          <li><strong>Images in your notes</strong> (desktop) — drop an image onto the editor, or paste a screenshot (Ctrl+V): the file is copied into your project next to the active note and an image link is inserted at the cursor. Dropping onto the file panel still just copies the file.</li>
          <li><strong>YAML suggestions</strong> — click into the frontmatter block (the <code>---</code> section at the top of a note) and a menu offers the keys and values already used across your project, so tags and metadata never need retyping. Arrow keys select, Enter inserts, Escape closes; it also opens as you type. Works only inside frontmatter.</li>
          <li><strong>Project search</strong> (desktop) — the magnifier in the file panel (or Ctrl+Shift+F) searches every note in your project. Click a result to open the file with the match selected; Escape brings the file tree back. Plain text matching — use the in-document find bar (Ctrl+F) for regex.</li>
          <li><strong>Outline text size</strong> — the − and + buttons in the Outline panel header scale just the outline list (also under Settings → Outline font size); nothing else in the UI changes.</li>
          <li><strong>PDF export</strong> — File menu → Export as .pdf opens an options window: optional front page (title, author, a low-opacity cover image — one of the built-in backgrounds or your own — centered or corner layout), clickable table of contents, article or book layout, margins, font, font size (8–18 pt), page size (A4/A5/A6/Letter), page numbers, and optional page breaks before every H1 and/or H2. It renders like the preview (code colors, math; with the Harald font, bold text shows as underlined — its brand style). The Electron desktop app saves the PDF directly; on Tauri and in the browser the system print dialog opens (choose “Save as PDF”).</li>
          <li><strong>LaTeX project export</strong> — File menu → LaTeX project (.zip) exports a ready-to-compile folder: main.tex plus an images/ folder with every referenced picture. Options: pdflatex or xelatex, five templates — Article, Report, Book, plus the styled Book (Revery) and Homework (Revery) — title page, table of contents on its own page, and optional page breaks before H1/H2. The Revery templates need XeLaTeX (the menu only shows templates your chosen engine can compile), and Book (Revery) bundles its fonts into the zip. (In the browser it downloads a single .tex file.)</li>
          <li><strong>Custom templates</strong> — the Insert YAML ▸ (Toolbar menu) and Import Template ▸ (File menu) lists end with <em>New template…</em>: give it a name, write the content, press Create — it appears in the menu right away and is stored on this computer. Hover a custom entry and click the ✕ to delete it; the built-in templates are untouchable.</li>
          <li><strong>Path suggestions in links</strong> (desktop) — typing inside a link destination like <code>![image](here)</code> opens a dropdown of the folders, images and notes at that spot in your project. Arrow keys + Enter accept; picking a folder inserts it and shows the next level.</li>
          <li><strong>Links follow renames</strong> (desktop) — renaming or moving a file or folder offers to update every markdown link that points at it (you are shown exactly which files change before anything is written). Undo (Ctrl+Z with the editor unfocused) restores the links too.</li>
          <li><strong>Advanced Options</strong> — click the top bar logo → Advanced Options: currently the logo position (centered, or in the left corner next to the File button). More advanced settings will live here over time.</li>
          <li><strong>Custom fonts</strong> — the Editor/Preview font menus end with <em>Custom font…</em>: import a font file (.ttf/.otf/.woff/.woff2) or type the name of a font installed on your computer, check the sample line, press Add. It appears in both font menus; hover it and click ✕ to remove (the app then falls back to the Harald font).</li>
        </ul>
      </section>
      <hr class="mod-guide-hr">
      <section class="mod-mb-8">
        <h4 class="mod-guide-h4">Markdown Basics</h4>
        <table class="mod-table">
          <thead><tr class="mod-th-row"><th class="mod-th-w52">You type</th><th class="mod-th">You get</th></tr></thead>
          <tbody>
            <tr><td class="mod-td-4"># Heading 1</td><td>Large heading (Chapters)</td></tr>
            <tr><td class="mod-td-4">## Heading 2</td><td>Medium heading (Subchapters)</td></tr>
            <tr><td class="mod-td-4">**bold**</td><td><strong>bold</strong> (shown underlined under the Harald font)</td></tr>
            <tr><td class="mod-td-4">*italic*</td><td><em>italic</em></td></tr>
            <tr><td class="mod-td-4">~~strikethrough~~</td><td><s>strikethrough</s></td></tr>
            <tr><td class="mod-td-4">\`inline code\`</td><td>inline code</td></tr>
            <tr><td class="mod-td-4">\`\`\`<br>code block<br>\`\`\`</td><td>Fenced code block</td></tr>
            <tr><td class="mod-td-4">- item</td><td>Bullet list item</td></tr>
            <tr><td class="mod-td-4">1. item</td><td>Numbered list item</td></tr>
            <tr><td class="mod-td-4">- [ ] task</td><td>Checkbox (unchecked)</td></tr>
            <tr><td class="mod-td-4">- [x] task</td><td>Checkbox (checked)</td></tr>
            <tr><td class="mod-td-4">[text](url)</td><td>Hyperlink</td></tr>
            <tr><td class="mod-td-4">![alt](image-url)</td><td>Inline image</td></tr>
            <tr><td class="mod-td-4">&gt; quote</td><td>Blockquote</td></tr>
            <tr><td class="mod-td-4">--- (own line)</td><td>Horizontal rule</td></tr>
            <tr><td class="mod-td-4">| A | B |<br>|---|---|<br>| 1 | 2 |</td><td>Table</td></tr>
            <tr><td class="mod-td-4">[^1] / [^1]: note</td><td>Footnote</td></tr>
          </tbody>
        </table>
        <p class="mod-guide-tip">Tip: Use the <strong>Toolbar</strong> menu to insert most of these without typing them by hand.</p>
      </section>
      <hr class="mod-guide-hr">
      <section class="mod-mb-8">
        <h4 class="mod-guide-h4">LaTeX support</h4>
        <p class="mod-guide-tip">This editor has LaTeX support (through "KaTeX"). Use "$$ . . . $$" for equation blocks and "$ . . . $" for having the equation in the text. <strong>Note</strong> that after the dollar sign, no gap between the "$" and the first syntax symbol, otherwise it will not render it out correctly.</p>
      </section>
    `,
    Swedish: `
      <section class="mod-mb-20">
        <h4 class="mod-guide-h4">Tangentbordsgenvägar</h4>
        <table class="mod-table">
          <tbody>
            <tr><td class="mod-td-w52">Ctrl + F</td><td class="mod-td">Öppna Sök / Ersätt</td></tr>
            <tr><td class="mod-td-w52">Ctrl + Z</td><td class="mod-td">Ångra (utanför redigeraren: ångrar senaste filflytt/namnbyte)</td></tr>
            <tr><td class="mod-td-w52">Ctrl + Y</td><td class="mod-td">Gör om</td></tr>
            <tr><td class="mod-td-w52">Ctrl + S</td><td class="mod-td">Exportera / spara fil</td></tr>
            <tr><td class="mod-td-w52">Tab (i redigeraren)</td><td class="mod-td">Infoga 4 mellanslag</td></tr>
          </tbody>
        </table>
      </section>
      <hr class="mod-guide-hr">
      <section class="mod-mb-20">
        <h4 class="mod-guide-h4">Inställningstips</h4>
        <ul class="mod-guide-ul">
          <li><strong>Visa förhandsgranskning</strong> — växla den levande förhandsgranskningen på eller av. Genom att dölja den får du en helbreddsredigerare.</li>
          <li><strong>Visa disposition</strong> — öppnar en navigeringspanel för rubriker till höger. Klicka på en rubrik för att hoppa till den.</li>
          <li><strong>Läsläge</strong> — döljer redigeraren helt för en ren, störningsfri läsvy. Tryck på <em>Avsluta läsläge</em> för att återgå.</li>
          <li><strong>Mobilvy</strong> — ramar in förhandsgranskningen i en telefonbredd så att du ser hur ditt innehåll ser ut på små skärmar (lita inte för mycket på detta...).</li>
          <li><strong>UI-storlek / textstorlek</strong> — "UI-storlek" skalar menyknappar; "Textstorlek" skalar redigerings- och förhandsgranskningstext.</li>
          <li><strong>Kalenderformat</strong> (Inställningar) — välj hur datum infogas när du använder datumverktyget.</li>
          <li><strong>Dra avdelaren</strong> — den vertikala stapeln mellan redigeraren och förhandsgranskningen kan dras åt vänster eller höger för att ändra storlek på varje ruta.</li>
          <li><strong>Klicka på ett förhandsgranskningsblock</strong> — hoppar redigerarens markör till motsvarande källrad.</li>
          <li><strong>CPU-prestandafördröjning</strong> — Högre värde = sparar batteri och CPU, men inte lika bra upplevelse. Lågt värde = drar mer CPU och batteri men jämnare upplevelse.</li>
          <li><strong>Tvingad förhandsgr.synk</strong> — "Tvingad förhandsgranskningssynkronisering" är en mer pålitlig synkronisering mellan redigeraren och förhandsgranskningsfönstret, men kan kännas lite ryckig. Använd om du märker att det du skriver inte syns i förhandsgranskningen.</li>
          <li><strong>Långsam hårdvara-läge</strong> — ett reglage för äldre datorer: färre diskskrivningar medan du skriver, lugnare förhandsgranskning, ingen bakgrundsbild och lättare filkort. Sparandet är precis lika kraschsäkert som annars.</li>
          <li><strong>Bakgrund &amp; opacitet</strong> — välj en av de inbyggda förhandsgranskningsbakgrunderna, stäng av den, eller importera en egen bild (sparas lokalt och skalas ner automatiskt). "Bakgrundsopacitet" styr hur tydligt den syns.</li>
          <li><strong>Live Preview (experimentell)</strong> — renderar dokumentet direkt i redigeraren genom samma renderare som förhandsgranskningen, så allt ser identiskt ut: typografi, rubriker, citat, listor, bilder, tabeller, LaTeX-matematik (även flerradig $$…$$) och färgkodade kodblock. Blocket du redigerar visar sin råa markdown; klicka på ett renderat block för att redigera det. Din fil på disk är alltid ren markdown.</li>
          <li><strong>Zip-export av projekt</strong> (skrivbord) — Arkiv-menyn → Zip-export av projekt sparar hela din projektmapp som ett .zip-arkiv där du vill. Perfekt för säkerhetskopior före stora omskrivningar. Arkivet skrivs säkert (aldrig halvfärdigt) och är inte lösenordsskyddat — använd krypterad lagring om dina anteckningar är känsliga.</li>
          <li><strong>Bilder i dina anteckningar</strong> (skrivbord) — släpp en bild på redigeraren, eller klistra in en skärmdump (Ctrl+V): filen kopieras in i ditt projekt bredvid den aktiva anteckningen och en bildlänk infogas vid markören. Att släppa på filpanelen kopierar bara filen som vanligt.</li>
          <li><strong>YAML-förslag</strong> — klicka i frontmatter-blocket (<code>---</code>-sektionen överst i en anteckning) så visas en meny med nycklar och värden som redan används i ditt projekt, så taggar och metadata aldrig behöver skrivas om. Piltangenter väljer, Enter infogar, Escape stänger; menyn öppnas också medan du skriver. Fungerar bara inuti frontmatter.</li>
          <li><strong>Projektsökning</strong> (skrivbord) — förstoringsglaset i filpanelen (eller Ctrl+Shift+F) söker i alla anteckningar i ditt projekt. Klicka på en träff för att öppna filen med träffen markerad; Escape tar tillbaka filträdet. Ren textsökning — använd dokumentsökningen (Ctrl+F) för regex.</li>
          <li><strong>Dispositionens textstorlek</strong> — knapparna − och + i dispositionspanelens rubrik skalar bara dispositionslistan (finns även under Inställningar → Dispositionens teckenstorlek); inget annat i gränssnittet påverkas.</li>
          <li><strong>PDF-export</strong> — Arkiv-menyn → Exportera som .pdf öppnar ett alternativfönster: valfri förstasida (titel, författare, en omslagsbild med låg opacitet — en av de inbyggda bakgrunderna eller en egen — centrerad eller hörnlayout), klickbar innehållsförteckning, artikel- eller boklayout, marginaler, typsnitt, teckenstorlek (8–18 pt), sidstorlek (A4/A5/A6/Letter), sidnummer och valfria sidbrytningar före varje H1 och/eller H2. Den renderas som förhandsgranskningen (kodfärger, matematik; med Harald-typsnittet visas fet text understruken — dess varumärkesstil). Electron-skrivbordsappen sparar PDF:en direkt; på Tauri och i webbläsaren öppnas systemets utskriftsdialog (välj ”Spara som PDF”).</li>
          <li><strong>LaTeX-projektexport</strong> — Arkiv-menyn → LaTeX-projekt (.zip) exporterar en färdig att kompilera-mapp: main.tex plus en images/-mapp med alla refererade bilder. Alternativ: pdflatex eller xelatex, fem mallar — Artikel, Rapport, Bok samt de stilade Bok (Revery) och Inlämning (Revery) — titelsida, innehållsförteckning på egen sida och valfria sidbrytningar före H1/H2. Revery-mallarna kräver XeLaTeX (menyn visar bara mallar som den valda motorn kan kompilera), och Bok (Revery) paketerar sina typsnitt i zip-filen. (I webbläsaren laddas en enda .tex-fil ner.)</li>
          <li><strong>Egna mallar</strong> — listorna Infoga YAML ▸ (Verktyg-menyn) och Importera mall ▸ (Arkiv-menyn) slutar med <em>Ny mall…</em>: ge den ett namn, skriv innehållet, tryck Skapa — den dyker upp i menyn direkt och sparas på den här datorn. Håll muspekaren över en egen mall och klicka på ✕ för att radera den; de inbyggda mallarna kan inte ändras.</li>
          <li><strong>Sökvägsförslag i länkar</strong> (skrivbord) — när du skriver i en länkdestination som <code>![bild](här)</code> öppnas en meny med mappar, bilder och anteckningar på den platsen i ditt projekt. Piltangenter + Enter väljer; väljer du en mapp infogas den och nästa nivå visas.</li>
          <li><strong>Länkar följer namnbyten</strong> (skrivbord) — när du byter namn på eller flyttar en fil eller mapp erbjuds du att uppdatera alla markdown-länkar som pekar på den (du ser exakt vilka filer som ändras innan något skrivs). Ångra (Ctrl+Z när redigeraren inte har fokus) återställer även länkarna.</li>
          <li><strong>Avancerade alternativ</strong> — klicka på logotypen i topplisten → Avancerade alternativ: för närvarande logotypens position (centrerad, eller i vänstra hörnet bredvid Arkiv-knappen). Fler avancerade inställningar hamnar här med tiden.</li>
          <li><strong>Egna typsnitt</strong> — typsnittsmenyerna för redigeraren/förhandsgranskningen slutar med <em>Eget typsnitt…</em>: importera en typsnittsfil (.ttf/.otf/.woff/.woff2) eller skriv namnet på ett typsnitt som är installerat på datorn, kontrollera exempelraden och tryck Lägg till. Det dyker upp i båda typsnittsmenyerna; håll muspekaren över det och klicka på ✕ för att ta bort (appen återgår då till Harald-typsnittet).</li>
        </ul>
      </section>
      <hr class="mod-guide-hr">
      <section class="mod-mb-8">
        <h4 class="mod-guide-h4">Markdown-grunder</h4>
        <table class="mod-table">
          <thead><tr class="mod-th-row"><th class="mod-th-w52">Du skriver</th><th class="mod-th">Du får</th></tr></thead>
          <tbody>
            <tr><td class="mod-td-4"># Rubrik 1</td><td>Stor rubrik (Kapitel)</td></tr>
            <tr><td class="mod-td-4">## Rubrik 2</td><td>Mellanrubrik (Delkapitel)</td></tr>
            <tr><td class="mod-td-4">**fet**</td><td><strong>fet</strong> (visas understruken med Harald-typsnittet)</td></tr>
            <tr><td class="mod-td-4">*kursiv*</td><td><em>kursiv</em></td></tr>
            <tr><td class="mod-td-4">~~genomstruken~~</td><td><s>genomstruken</s></td></tr>
            <tr><td class="mod-td-4">\`inline-kod\`</td><td>inline-kod</td></tr>
            <tr><td class="mod-td-4">\`\`\`<br>kodblock<br>\`\`\`</td><td>Inhägnat kodblock</td></tr>
            <tr><td class="mod-td-4">- punkt</td><td>Punktlista</td></tr>
            <tr><td class="mod-td-4">1. punkt</td><td>Numrerad lista</td></tr>
            <tr><td class="mod-td-4">- [ ] uppgift</td><td>Kryssruta (tom)</td></tr>
            <tr><td class="mod-td-4">- [x] uppgift</td><td>Kryssruta (ifylld)</td></tr>
            <tr><td class="mod-td-4">[text](url)</td><td>Hyperlänk</td></tr>
            <tr><td class="mod-td-4">![alt](bild-url)</td><td>Inline-bild</td></tr>
            <tr><td class="mod-td-4">&gt; citat</td><td>Citatblock</td></tr>
            <tr><td class="mod-td-4">--- (egen rad)</td><td>Horisontell linje</td></tr>
            <tr><td class="mod-td-4">| A | B |<br>|---|---|<br>| 1 | 2 |</td><td>Tabell</td></tr>
            <tr><td class="mod-td-4">[^1] / [^1]: not</td><td>Fotnot</td></tr>
          </tbody>
        </table>
        <p class="mod-guide-tip">Tips: Använd <strong>Verktyg</strong>-menyn för att infoga de flesta av dessa utan att skriva dem för hand.</p>
      </section>
      <hr class="mod-guide-hr">
      <section class="mod-mb-8">
        <h4 class="mod-guide-h4">Latex-stöd</h4>
        <p class="mod-guide-tip">Denna redigerare har LaTeX-stöd (via "KaTeX"). Använd "$$ . . . $$" för ekvationsblock och "$ . . . $" för att ha ekvationen i texten. <strong>Obs</strong> att efter dollartecknet får det inte finnas något mellanrum mellan "$" och den första syntaxsymbolen, annars renderas det inte ut korrekt.</p>
      </section>
    `
  }
};

// Define the Global Translation Helper 
// Global translation helper
window.t = function(englishString) {
  const lang = window.uiLanguage || 'English';
  if (lang === 'English') return englishString;
  
  if (window.uiTranslations[englishString] && window.uiTranslations[englishString][lang]) {
    return window.uiTranslations[englishString][lang];
  }
  return englishString; // Fallback to English if translation is missing
};
