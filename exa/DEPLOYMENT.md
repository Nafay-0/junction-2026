# Beryl in production

Set up on Saturday 14 November 2026 in the Google Cloud project `beryl-exa`, region `europe-north1`. The project is meant to stay up through Sunday 15 November and be shut down after.

- Site: https://beryl.zeroanomaly.tech (once the DNS record below is in)
- Always works, with HTTPS: https://beryl-58963151537.europe-north1.run.app
- Health: `/api/health` on either address

## What runs

| Piece | Name | Notes |
|---|---|---|
| Server | Cloud Run service `beryl` | Exactly one instance, always on (min 1, max 1, CPU never throttled), 2 vCPU, 2 GB, requests up to 60 minutes. Running tasks live in its memory, so it must not scale. |
| Database | Cloud SQL `beryl`, Postgres 17 | 1 vCPU, 3.75 GB, 10 GB disk. Database `beryl`, user `beryl`. The server reaches it through the socket Cloud Run mounts. Maintenance window is Wednesday, so not this weekend. |
| Secrets | Secret Manager | `EXA_API_KEY`, `ANTHROPIC_AWS_API_KEY`, `ANTHROPIC_AWS_WORKSPACE_ID`, `GOOGLE_API_KEY`, `ADMIN_PASSWORD`, `DATABASE_URL`. Copied from `exa/.env.local` at setup, so the live admin signs in with the same email and password as locally. |
| Images | Artifact Registry `beryl` | `europe-north1-docker.pkg.dev/beryl-exa/beryl/web` |
| Desktop installers | Bucket `gs://beryl-exa-downloads` | Public. The site's `/download/...` links redirect there. |
| Domain and HTTPS | Global load balancer | Address `136.68.87.95`, a Google-managed certificate for `beryl.zeroanomaly.tech`, and a redirect from http to https. |
| Accounts | `beryl-run` (the server), `beryl-deploy` (GitHub Actions) | GitHub signs in without a stored key, and only this repository may. |

## The one DNS record

At the registrar of `zeroanomaly.tech`:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `beryl` | `136.68.87.95` | 300 (or the lowest offered) |

Nothing else is needed. No AAAA record, no CNAME. Once the record resolves, Google issues the certificate on its own, usually within 15 to 60 minutes. Until then `https://beryl.zeroanomaly.tech` shows a certificate error and the `run.app` address is the one to use.

Check progress with:

```bash
gcloud compute ssl-certificates describe beryl-cert --project beryl-exa --global --format="value(managed.status,managed.domainStatus)"
```

## Deploying

By hand, from `exa/web`:

```bash
gcloud builds submit . --project beryl-exa --region europe-north1 --tag europe-north1-docker.pkg.dev/beryl-exa/beryl/web:<tag>
gcloud run deploy beryl --project beryl-exa --region europe-north1 --image europe-north1-docker.pkg.dev/beryl-exa/beryl/web:<tag>
```

The second command only changes the image. The service keeps its settings.

From GitHub, once these files are on `main` (they are in `.github/workflows/`, which is otherwise Nafay's folder; they only run for changes under `exa/`):

- `beryl-ci.yml`: typecheck, lint and the guard test on every push that touches `exa/`.
- `beryl-deploy.yml`: builds and deploys the server when `main` changes under `exa/web`, or when started by hand.
- `beryl-desktop.yml`: builds the three installers and uploads them, for a tag like `beryl-v0.2.0` or by hand.

None of the three has run yet: they start working after the first push.

**A deploy restarts the server, and a task running at that moment is lost.** During the judging, do not push to `main` under `exa/web` unless you mean to redeploy.

## Desktop installers

```bash
BERYL_SERVER_URL=https://beryl.zeroanomaly.tech pnpm desktop:release
gcloud storage cp desktop/release/downloads/* gs://beryl-exa-downloads/ --cache-control="no-cache, max-age=0"
```

The address is baked into the app. The installers in the bucket today open the `run.app` address, which keeps working; they are rebuilt for the domain once its certificate is active.

## Changing a setting

- A key: `printf %s "<value>" | gcloud secrets versions add <NAME> --project beryl-exa --data-file=-`, then `gcloud run services update beryl --project beryl-exa --region europe-north1 --update-secrets <NAME>=<NAME>:latest`.
- The demo video: `gcloud run services update beryl --project beryl-exa --region europe-north1 --update-env-vars BERYL_DEMO_VIDEO=<link>`.

Each of these starts a new revision, so the same warning about running tasks applies.

## Not done

- Nobody has signed in on the live site from this setup: the checks so far are the ones that need no account (health, the landing page, the sign-in page, the API gate, downloads). Sign in once and run a search, a research task and a call.
- The installers are not signed or notarised, and the Windows and Intel builds have not been run.
- No alerting. If the site matters after Sunday, add an uptime check on `/api/health`.
- Running tasks are in the server's memory. For more than one instance they would move to Redis.

## Shutting it down

Deleting the project removes everything. To keep the project but stop paying for the two things that cost money, delete the Cloud Run service and the Cloud SQL instance, and release the address `beryl-ip`.
