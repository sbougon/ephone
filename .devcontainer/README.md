# Devcontainer

Sandboxed environment for running Claude Code autonomously against the
Emergency Phone PWA (static files, no build step).

## First-time setup

1. Open the repo in VS Code with the **Dev Containers** extension, then
   *Reopen in Container* — or use the CLI:
   ```
   devcontainer up --workspace-folder .
   devcontainer exec --workspace-folder . bash
   ```
2. Inside the container, authenticate GitHub once:
   ```
   gh auth login
   ```
   The token is stored in the `emergency-phone-gh-config` named volume and
   persists across rebuilds.
3. Serve the PWA (host browser hits it via the forwarded port):
   ```
   serve -l 8080 .
   ```
   Open `http://localhost:8080/` on your host.

   `localhost` counts as a secure context, so the service worker and Wake Lock
   work over plain HTTP. (Some iOS-only behavior still needs real HTTPS on a
   device — for that, serve over your LAN behind an HTTPS tunnel.)

## AWS credentials (CDK deploys)

The container has no access to the host's `~/.aws`, so the credentials for the
`ringmeplease-cdk-admin` IAM user live in `.aws/` at the repo root
(`.aws/credentials` + `.aws/config`). This directory is **git-ignored** — never
commit it. `devcontainer.json` sets `AWS_SHARED_CREDENTIALS_FILE`,
`AWS_CONFIG_FILE`, and `AWS_PROFILE` so the AWS CLI / CDK pick it up
automatically. Inside the container you can run infra changes directly:

```
cd infra && npx cdk deploy
```

The user is scoped to only assume the CDK bootstrap roles (no standing admin).
If you ever rotate the key on the host, re-copy it into `.aws/credentials`.

## Memory

Claude's memory for this project is bind-mounted from the host at
`~/.claude/projects/-Users-steven-projects-emergency-phone/memory` into
`/home/node/.claude/projects/-workspace/memory`. Because the workspace is
`/workspace`, Claude Code inside the container resolves its project slug to
`-workspace` and reads/writes that same directory — so memory is shared live
with the host.

## Timezone

The container runs on `America/Los_Angeles` (US Pacific, DST-aware) rather than
the default UTC. It's set via `ENV TZ` in the Dockerfile with `tzdata`
installed, so `date`, Node, and Claude all report Pacific time.

## Running Claude inside the container

```
claude --dangerously-skip-permissions
```

The `emergency-phone-claude-config` named volume persists Claude's auth and
history.

Edits land in the bind-mounted workspace, so commits/pushes show up on the host
git tree as usual.
