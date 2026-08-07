---
name: "git-auto-push"
description: "Automates git workflow: stage all changes, generate commit message, pull remote main, merge, and push. Invoke when user says '提交代码', '推送更新', 'commit', 'push', or similar git-related requests."
---

# Git Auto Push

This skill automates the complete git workflow for committing and pushing code changes.

## Trigger Conditions

Invoke this skill when the user says any of the following (or similar):
- "提交代码" / "提交"
- "推送更新" / "推送"
- "commit" / "push"
- "暂存并提交"
- "同步到远程"

## Workflow Steps

### Step 1: Check Status
Run `git status` to see all modified, added, and deleted files.

### Step 2: Stage All Changes
Run `git add -A` to stage all changes.

### Step 3: Generate Commit Message
Analyze the staged changes using `git diff --cached --stat` and `git diff --cached` to understand what was changed. Generate a concise, conventional commit message following these rules:
- Use conventional commit prefixes: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`
- Keep the subject line under 72 characters
- Write in the same language as the user's recent messages (Chinese if user speaks Chinese)
- Focus on WHAT changed and WHY, not HOW

### Step 4: Commit
Run `git commit -m "<generated message>"`

### Step 5: Pull Remote Main
Run `git pull origin main --no-edit` to fetch and merge remote changes.

**If merge conflicts occur:**
- Stop immediately
- List the conflicting files
- Tell the user: "检测到合并冲突，请手动处理以下文件的冲突：[file list]"
- Do NOT attempt to resolve conflicts automatically
- Wait for user to resolve and confirm before proceeding

### Step 6: Push to Remote
If pull succeeded without conflicts, run `git push` to push to remote.

### Step 7: Report Result
Summarize the result:
- Commit hash
- Files changed
- Push status (success or failure)

## Error Handling

- If `git pull` fails due to network issues, retry once after 3 seconds
- If push fails, inform the user and suggest manual retry
- If no changes to commit, inform the user: "没有需要提交的更改"
