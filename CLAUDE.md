# Revery Notebook

A web and offline markdown editor. For students, researchers and for everyone who just wants to write on a simple editor.

## Web version

A one document text experience before downloading the offline version. See it as a live demo of the software.


## Offline version

Users can pick an installer that is either an Electron or a Tauri wrapper, either choice should provide a stable and safe user experience with (ideally) no risk of losing data. 

## Known issues

- The Regex search can be buggy, don't know if there is a safe fix that won't break anything. 

- The CSS is from an old website (that uses Tailwind), I liked the aesthetics but contains a lot of dead code and is messy, The dev.sh and dev.bat is not working for this project.

- Messy legacy code?, must clean up without breaking anything for future easier maintenance (modular and but not too refracted so the web version loads too many js files). 


## Must fix

- Better save/load logic. No risk of file corruptions and no race condition (right now I have no idea how safe it is). Risk of users losing data and hardware failure because of this app, must be investigated before anything happens. (First thing to address after code clean up, making it modular to reduce bug risks when working and easier to read etc)

- Right now, emojis were used for icons in the UI. It was supposed to use the emojis from the harald revery font, but this doesn't always work and sometimes renders the emojis using the system font emojis. No idea how to reliably render icons. 

- The app should never open links.  It should not act as a browser. The borderless UI makes it impossible to close the software if the user by mistake clicks a link. 


## Future features (when the app is safe and in good code condition)

- Adjust the bg texture opacity in the settings and allow the user to import a custom background too? 

- Obsidian-style Live Preview, instead of a raw text and a live preview side by side, they can be in the same panel. This mode can be toggled on/off in the settings for users who prefer the old (current) way.

- About, legal and user guide text update (so it's up to date and accurate).

- Maybe a search bar for the project folder? Might be too difficult to get it right (don't want to clutter the UI even more).

- Quality of life user experience, check how importing and drag and drop images work. Make it easier for users to work with images in their documents (a little vaguely defined). 

- In Obsidian, when clicking on the rendered YAML part in the text, a drop menu (scrollable) with all existing tags of the project is shown, in that way user doesn't have to type every single time they want to use a standard YAML data for something. This would be a nice feature, but I have no idea if it can be implemented without conflicting with codemirror.