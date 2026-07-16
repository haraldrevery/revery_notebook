# Revery Notebook

A web and offline markdown editor. For students, researchers and for everyone who just wants to write on a simple editor.

## Web version

A one document text experience before downloading the offline version. See it as a live demo of the software.


## Offline version

Users can pick an installer that is either an Electron or a Tauri wrapper, either choice should provide a stable and safe user experience with (ideally) no risk of losing data. 

## Known issues

- The Regex search can be buggy, don't know if there is a safe fix that won't break anything. 

- Messy legacy code?, must clean up without breaking anything for future easier maintenance (modular and but not too refracted so the web version loads too many js files). 


## Must Evaluate

- Check the save/load logic. No risk of file corruptions and no race condition (right now I have no idea how safe it is). Risk of users losing data and hardware failure because of this app, must be investigated before anything happens. (First thing to address after code clean up, making it modular to reduce bug risks when working and easier to read etc)

- The app should never open links.  It should not act as a browser. The borderless UI makes it impossible to close the software if the user by mistake clicks a link. 


## Future features (when the app is safe and in good code condition)


- About, legal and user guide text update (so it's up to date and accurate).



