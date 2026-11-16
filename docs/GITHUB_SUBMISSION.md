# Submitting through a private GitHub repository

I did not create a repository or grant access for you; do these steps yourself.

```bash
cd reachinbox
git init -b main           # skip if already a git repo
git add .
git status                 # confirm there is NO .env file and no node_modules
git commit -m "ReachInbox full-stack email scheduler"
```
1. On github.com click **New repository**, name it (e.g. `reachinbox-assignment`), choose **Private**, do not add a README, click **Create**.
2. Connect and push:
```bash
git remote add origin https://github.com/<your-username>/reachinbox-assignment.git
git push -u origin main
```
3. Grant access: repository → **Settings → Collaborators → Add people**, enter each reviewer's GitHub username or email from the assignment email, choose **Read** (or what they asked for), send the invite.
4. Double-check no secrets: `git log -p | grep -iE "client_secret|xoxb-|BEGIN PRIVATE"` should print nothing. If you ever commit a real secret, rotate it.
