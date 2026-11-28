# RESA sync — self-hosted account + team workspace

A small, self-hosted backend that gives RESA three things the local-only app
cannot do on its own:

- **An account** — sign up / sign in with an email and a password.
- **Sync across devices** — desktop and phone read and write the same records.
- **A team workspace** — a task handed to a teammate lands in their own app, and
  the person who handed it over can follow the activity on it.

It is plain Postgres plus two small services, so it runs comfortably on a
4 GB VPS. The desktop app talks to one origin and prefixes each half, exactly
like Supabase does:

```
/auth/v1/*  -> GoTrue    (sign up, sign in, refresh)
/rest/v1/*  -> PostgREST (sync_records, sync_push, workspaces)
```

## Bring it up

```bash
cd deploy/sync
docker compose up -d
docker compose ps                 # wait for db to be healthy
```

The first boot creates the roles and GoTrue runs its own migrations. Then apply
the sync schema once:

```powershell
Get-Content sql/10-sync.sql -Raw | docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1
```

Check it:

```bash
curl http://localhost:8000/health          # ok
```

### Docker Hub is blocked?

Some networks get `403 Forbidden` from `registry-1.docker.io`. Set a mirror in
`.env` and re-run:

```
REGISTRY=docker.iranserver.com/
```

## Smoke test

```powershell
$sec = (Get-Content .env | Where-Object { $_ -like 'JWT_SECRET=*' }).Split('=')[1].Trim()
$anon = ((node scripts/keys.mjs $sec) -split "`n" | Where-Object { $_ -like 'ANON_KEY=*' }).Split('=')[1].Trim()
node scripts/smoke.mjs $anon
```

It signs up two accounts, pushes a task, invites the second account into the
first one's workspace, and checks that both see the same row, that the second
can update it, that the first sees who updated it, and that an outsider sees
nothing. Every line should print `PASS`.

## Point the desktop build at it

The endpoint and public key are baked into the binary at compile time, so the
account screen only asks for an email and a password:

```powershell
pwsh deploy/sync/scripts/build-desktop.ps1
# or, for phones on the same LAN:
pwsh deploy/sync/scripts/build-desktop.ps1 -Endpoint http://192.168.1.20:8000
```

`http://` is accepted only for `localhost` and private addresses; a public
server must be `https://` (put Caddy or nginx in front with a real
certificate).

## How sharing works

| Table | Purpose |
| --- | --- |
| `workspaces` | one row per shared space; every account owns a personal one |
| `workspace_members` | who is in it, and as `owner` / `manager` / `member` |
| `workspace_invites` | an email plus a one-time token handed to the invitee |
| `sync_records` | the actual rows, keyed by `(workspace_id, entity, record_id)` |

Row-level security means an account only ever sees workspaces it belongs to.
`sync_push` falls back to the personal workspace when no workspace is given, so
an older client keeps working unchanged.

Delegation lives on the task itself: `assignee_user_id` is the account the task
was handed to, `delegated_by` / `delegated_at` record who handed it over and
when, and `task_events` (now synced) carries the activity timeline so the
delegator can see what actually happened.

## Files

```
docker-compose.yml        db + auth + rest + gateway
nginx/gateway.conf        the two proxy locations and /health
sql/00-roles.sql          roles PostgREST and GoTrue log in as (first boot only)
sql/10-sync.sql           workspaces, invites, sync_records, RLS, sync_push
scripts/keys.mjs          signs the anon / service JWTs from JWT_SECRET
scripts/smoke.mjs         end-to-end check
scripts/build-desktop.ps1 builds an installer that knows this server
.env                      secrets — never commit (already git-ignored)
```
