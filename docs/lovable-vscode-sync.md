# Lovable <-> VS Code Sync Workflow

This project uses Git as the single sync source between Lovable and local VS Code.

## Daily flow on `main`

### 1) Sync before coding locally

```bash
git checkout main
git fetch origin
git pull --rebase origin main
```

### 2) Commit and push local changes

```bash
git add .
git commit -m "your change message"
git push origin main
```

### 3) If both Lovable and local changed

```bash
git pull --rebase origin main
# resolve conflicts
git add .
git rebase --continue
git push origin main
```

## Feature branch flow (recommended)

```bash
git checkout -b feat/your-feature
# work and commit
git push -u origin feat/your-feature
```

Then merge into `main` (PR or local merge), and push `main`.

## Useful local aliases (already configured)

```bash
git sync-main      # checkout main + fetch + pull --rebase
git sync-lovable   # fetch + pull --rebase origin main
```

## Rules to avoid drift

- Pull first, push second.
- Do not keep local changes too long without syncing.
- Rebase latest `main` before big commits.
