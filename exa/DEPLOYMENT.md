# Beryl in production

Set up on Saturday 14 November 2026 in the Google Cloud project `beryl-exa`, region `europe-north1`. The project is meant to stay up through Sunday 15 November and be shut down after.

- Site: https://beryl.zeroanomaly.tech (live since 14 Nov, 16:33; the certificate is active and http redirects to https)
- The same server, without the domain: https://beryl-58963151537.europe-north1.run.app
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

They have been running since `exa/` reached `main` on 15 November. The checks failed on their first run (a fresh checkout has no generated route types) and were fixed by running `next typegen` first.

**A deploy restarts the server, and a task running at that moment is lost.** During the judging, do not push to `main` under `exa/web` unless you mean to redeploy.

## Desktop installers

```bash
BERYL_SERVER_URL=https://beryl.zeroanomaly.tech pnpm desktop:release
gcloud storage cp desktop/release/downloads/* gs://beryl-exa-downloads/ --cache-control="no-cache, max-age=0"
```

The address is baked into the app. The installers in the bucket open `https://beryl.zeroanomaly.tech` (last built and uploaded 14 Nov, 20:03, with the fix for the approval ring). The upload does not restart the server. The app's browser engine is inside the installer, so a change under `web/src/lib/browser/` or `web/desktop/` reaches people only through a new installer; the interface comes from the server and is new with every deploy.

## Email and scheduled jobs

- Deployed on 14 Nov at 20:10 (revision `beryl-00003-fg6`, image `web:live-1114-2005`, commit `565fc23`): jobs, notifications, chat addresses, the new landing page. The service now has the secret `RESEND_API_KEY` and `BERYL_SITE_URL=https://beryl.zeroanomaly.tech`; migration 0002 was applied on start.
- Deployed on 14 Nov at 22:32 (revision `beryl-00004-zqb`, image `web:live-1114-2230`, commit `dcf8180e`): the demo film on the landing page, first under the hero, and stock prices on a closed market. The film is `gs://beryl-exa-downloads/beryl-demo.mp4` (draft 3 of the video, 16.8 MB) and the service has `BERYL_DEMO_VIDEO` set to its public address. Checked signed out: health, the page's order, the film playing, the poster, the guards, one instance, no errors in the log.
- Deployed on 15 Nov at about 00:28 by `beryl-deploy.yml`, its first run (revision `beryl-00005-9p5`, image `web:4166065e…`, commit `4166065e`): `exa/` had just been merged into `main` and pushed. The code is the same as the revision before; the settings, the film's address among them, were kept. Checked signed out afterwards: health, the landing page and its film, no errors in the log.
- Emails (notifications, job results) go out through Resend from `notifications@beryl.zeroanomaly.tech`; the domain is verified there. The server needs `RESEND_API_KEY` as a secret, and `BERYL_SITE_URL=https://beryl.zeroanomaly.tech` so links in emails point at the site. `/api/health` says `"email": true` when the key is there.
- Jobs are started by a clock inside the server, so they run only while the one instance is up. That is already how the service is set (always on, exactly one instance). A job that came due during a deploy runs once the new revision is up; a run that was in progress when the server stopped is marked failed.
- Migration `0002_jobs_and_notifications` adds the tables. It is applied by the server when it starts, like the others.

## Changing a setting

- A key: `printf %s "<value>" | gcloud secrets versions add <NAME> --project beryl-exa --data-file=-`, then `gcloud run services update beryl --project beryl-exa --region europe-north1 --update-secrets <NAME>=<NAME>:latest`.
- The demo video: the film is a file in the downloads bucket, not in the image. Put it there with `gcloud storage cp <film>.mp4 gs://beryl-exa-downloads/beryl-demo.mp4 --project beryl-exa`, then point the page at it: `gcloud run services update beryl --project beryl-exa --region europe-north1 --update-env-vars BERYL_DEMO_VIDEO=https://storage.googleapis.com/beryl-exa-downloads/beryl-demo.mp4`. The still shown before play, `web/public/landing/demo-poster.jpg`, is in the image: a new film needs a new poster (a frame of it) and a deploy.

Each of these starts a new revision, so the same warning about running tasks applies.

## Not done

- Nobody has signed in on the live site from this setup: the checks so far are the ones that need no account (health, the landing page, the sign-in page, the API gate, downloads). Sign in once and run a search, a research task and a call.
- The installers are not signed or notarised, and the Windows and Intel builds have not been run.
- No alerting. If the site matters after Sunday, add an uptime check on `/api/health`.
- Running tasks are in the server's memory. For more than one instance they would move to Redis.

## Shutting it down

Deleting the project removes everything. To keep the project but stop paying for the two things that cost money, delete the Cloud Run service and the Cloud SQL instance, and release the address `beryl-ip`.
