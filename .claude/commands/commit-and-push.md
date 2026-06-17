Commit all staged and unstaged changes, then push to the remote.

Steps:
1. Run `git status` and `git diff` to review what will be committed.
2. Run `git log -5 --oneline` to match the existing commit message style.
3. Stage all modified tracked files with `git add -u`.
4. Write a concise commit message summarising the changes, then commit.
5. Push to the remote with `git push`.
6. Report the commit hash and push result.
