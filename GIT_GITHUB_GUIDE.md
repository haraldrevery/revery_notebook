# Git & GitHub — A Beginner's Guide

A practical guide to understanding Git and GitHub, and how to connect any
folder on your computer to a repository (GitHub or any other host) in the future.

---

## 1. The big idea (Git vs. GitHub)

These are two different things people often confuse:

| Thing | What it is | Where it lives |
|-------|-----------|----------------|
| **Git** | A tool that tracks the history of your files (every save you choose to record). | On **your computer**. |
| **GitHub** | A website that stores a **copy** of your Git history online so you can back it up and share it. | In the **cloud**. |

Git works perfectly fine with no internet and no GitHub at all. GitHub is just
one popular place to keep an online copy. Others exist (GitLab, Bitbucket, a
company server) — they all work the same way. This guide says "GitHub" but every
step applies to any of them; you just use a different link.

Think of it like writing a document:
- **Git** = the "track changes" + version history of your document.
- **GitHub** = Dropbox/Google Drive where you keep a backup copy of it.

---

## 2. Key words you'll keep seeing

- **Repository ("repo")** — a folder that Git is tracking. That's it. A repo is
  just a normal folder plus a hidden `.git` sub-folder.
- **The `.git` folder** — the hidden folder inside your repo where Git stores
  **all** your history and settings. ⚠️ **Never delete this.** Deleting it
  throws away your entire local history (this is the mistake that started all
  this). If it gets big, see [Section 8](#8-when-git-gets-big-do-this-not-that).
- **Commit** — a saved snapshot of your files at one moment, with a short
  message describing what changed. Your history is a chain of commits.
- **Branch** — a parallel line of work. The default one is usually called
  `main`. You can ignore branches until you need them.
- **Remote** — a nickname for an online copy of your repo. The default nickname
  is `origin`. So "`origin`" almost always means "my GitHub copy."
- **Clone** — downloading a repo (with its full history) from GitHub to your
  computer for the first time.
- **Push** — upload your new commits to GitHub.
- **Pull** — download new commits from GitHub into your local folder.

The mental model:

```
   your folder  --- commit --->  local Git history  --- push --->  GitHub
   (your files)                  (the .git folder)   <-- pull ---   (backup)
```

---

## 3. One-time setup (only do this once per computer)

Tell Git who you are. This is stamped onto every commit you make.

```bash
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
```

Use the **same email** as your GitHub account so your commits are linked to you.

---

## 4. Two ways to start — pick the one that fits

### Path A — You already have a folder, and want to put it on GitHub

This is the most common case (and matches your project).

1. **Create an empty repo on GitHub first.**
   Go to GitHub → click **New repository** → give it a name → **do not** add a
   README or `.gitignore` (keep it empty so there's nothing to collide with) →
   **Create**. Copy the URL it shows you, e.g.
   `https://github.com/yourname/your-repo.git`

2. **In your folder, turn it into a Git repo and make your first commit:**

   ```bash
   cd /path/to/your/folder
   git init                      # creates the hidden .git folder
   git add .                     # stage ALL current files
   git commit -m "Initial commit"
   ```

3. **Connect it to GitHub and upload:**

   ```bash
   git remote add origin https://github.com/yourname/your-repo.git
   git branch -M main            # name the branch "main"
   git push -u origin main       # upload; -u links them for next time
   ```

Done. From now on `git push` and `git pull` "just work" because `-u` linked your
branch to `origin/main`.

### Path B — The repo already exists on GitHub, and you want it on your computer

```bash
cd /path/to/where/you/keep/projects
git clone https://github.com/yourname/your-repo.git
```

This creates a new folder with all the files **and** the full history, already
connected to GitHub. No further setup needed.

> 💡 If you ever lose your `.git` folder but the code is safely on GitHub,
> cloning fresh (Path B) into a new folder is the cleanest recovery.

---

## 5. Your everyday workflow

Once set up, this is the loop you'll repeat forever:

```bash
# 1. See what you've changed
git status

# 2. Stage the changes you want to save
git add .                       # everything, or:
git add path/to/one-file.md     # just one file

# 3. Save a snapshot with a message
git commit -m "Describe what you changed"

# 4. Back it up to GitHub
git push
```

And when you sit down to work (especially on more than one computer), grab any
updates first:

```bash
git pull
```

**A good habit:** commit small and often, and push when you finish a chunk of
work. Every push is a backup you can return to.

---

## 6. Checking where things stand

Handy commands that only *show* information and never change anything — safe to
run anytime:

```bash
git status            # what's changed / staged / not yet committed
git log --oneline     # list of past commits (press q to quit)
git remote -v         # which GitHub URL(s) this folder is connected to
git branch -vv        # your branches and which remote they track
```

---

## 7. Connecting an existing folder to a *different* repo link

Say you want to point a folder at a new GitHub URL (new account, moved repo,
switching hosts). You're just changing the `origin` nickname's address:

```bash
git remote -v                                   # see the current link
git remote set-url origin https://github.com/new/link.git
git remote -v                                   # confirm it changed
```

If there's **no** remote yet, use `add` instead of `set-url`:

```bash
git remote add origin https://github.com/new/link.git
```

To remove a wrong one: `git remote remove origin`, then add the correct one.

---

## 8. When Git gets big — do this, NOT that

It's normal for the `.git` folder to grow, because it stores your whole history.
If size becomes a concern:

- ✅ **`git gc`** — safely compresses the `.git` folder. Harmless.
- ✅ **`.gitignore`** — a text file listing things Git should *ignore* so they
  never bloat history in the first place (build outputs, `node_modules/`, large
  temp files). Example contents:

  ```
  node_modules/
  dist/
  *.log
  .DS_Store
  ```

- ✅ **Git LFS** — the proper way to handle big binary files (videos, large
  images, datasets).
- ❌ **Never delete the `.git` folder.** That deletes your history, not just its
  size. If everything was already pushed to GitHub, you got lucky and can
  re-clone; if not, the work is gone for good.

---

## 9. Common problems & quick fixes

| Symptom | What it usually means | Fix |
|--------|----------------------|-----|
| `fatal: not a git repository` | This folder isn't tracked by Git (no `.git`). | Run `git init` (Path A) or `git clone` (Path B). |
| `fatal: 'origin' does not appear...` / no remote | No GitHub link is set. | `git remote add origin <url>` |
| `Updates were rejected` / `non-fast-forward` | GitHub has commits you don't have locally. | `git pull` first, then `git push`. |
| `refusing to merge unrelated histories` | Local and GitHub have separate histories (e.g. after losing `.git`). | Safest: re-`clone` fresh, or ask for help before force-pushing. |
| Asked for username/password on push | GitHub no longer accepts passwords. | Use a **Personal Access Token** (GitHub → Settings → Developer settings → Tokens) as the password, or set up SSH keys. |

> ⚠️ **About `git push --force`:** it *overwrites* GitHub with your local
> version and can erase history that exists only online. Avoid it unless you're
> certain, and never as a first response to an error.

---

## 10. The 10-second cheat sheet

```bash
# Start tracking an existing folder and push it up:
git init
git add .
git commit -m "Initial commit"
git remote add origin <URL>
git branch -M main
git push -u origin main

# Copy an existing GitHub repo down to your computer:
git clone <URL>

# The daily loop:
git status
git add .
git commit -m "message"
git push

# Get others' / your other machine's changes:
git pull
```

---

*Golden rules: commit often, push to back up, pull before you start, and never
delete the `.git` folder.*
