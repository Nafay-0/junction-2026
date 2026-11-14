# Deploying Beryl: the plan

Nothing here is set up yet. This is what I propose, what it costs, and what I need before I start.

## What has to run

| Piece | What it is | Why it matters for hosting |
|---|---|---|
| Web server | The Next.js app in `exa/web` | Must be one process that stays up. Running tasks live in its memory (`src/lib/runs.ts`), so it cannot scale to zero or to several copies. |
| Database | Postgres | Accounts, conversations, usage. Migrations run when the server starts. |
| Desktop downloads | Three files, about 100 MB each | Too big to ship inside the server image. They go in a public bucket. |
| Secrets | Exa, Claude on AWS, Gemini, admin login | Never in the repo or the image. |

Voice needs nothing extra: the browser talks to Gemini directly with a short-lived token from our server.

## Proposed setup on GCP

Region `europe-north1` (Finland), everything in one project.

- **Cloud Run** for the web server, pinned to exactly one instance (min 1, max 1) with CPU always on. That keeps background tasks alive between requests and keeps the task list in one place. Requests can stream for up to 60 minutes, which covers the longest research.
- **Cloud SQL for Postgres**, the smallest shared-core instance, connected from Cloud Run through the built-in connector.
- **Secret Manager** for every key and the admin password, mounted as environment variables.
- **Artifact Registry** for the Docker image.
- **Cloud Storage** bucket, public read, for the desktop installers. The site's `/download/...` links redirect there (`BERYL_DOWNLOADS_URL`).
- **Domain**: mapped straight onto the Cloud Run service (supported in `europe-north1`), with Google's managed certificate. A `downloads.` subdomain is optional; the bucket's own URL works too.

Rough cost: about 50 to 60 USD a month for the always-on instance, about 10 USD for the database, cents for the rest. A small VM running Docker would be cheaper (about 15 USD) but we would look after it ourselves. I'd take Cloud Run unless the budget says otherwise.

One thing to know: a deploy restarts the server, and a task running at that moment is lost (its conversation keeps what was saved up to its last step). Fine for now. The fix later is to move the running-task list to Redis.

## CI/CD

GitHub Actions, signing in to GCP with Workload Identity Federation, so no key file is stored anywhere.

1. **Checks** on every push that touches `exa/`: typecheck, lint, the guard test.
2. **Web deploy** on push to `main` that touches `exa/`: build the image, push it, deploy the new revision to Cloud Run. The server applies migrations as it starts.
3. **Desktop release** on a tag like `beryl-v0.2.0`: a macOS runner builds the two Mac installers and the Windows one, with the real server address baked in, and uploads them to the bucket. The download buttons on the site then serve the new version.

`.github/workflows/` is Nafay's folder under our repo rules, and Dock already has `ci.yml` there. I'd add files named `beryl-*.yml` that only run for changes under `exa/`. Nafay needs to be fine with that.

## What I'd change in the code first (small)

- A `Dockerfile` and `.dockerignore` in `exa/web`, with Next's standalone output.
- A `/api/health` route for Cloud Run's checks.
- `BERYL_DOWNLOADS_URL` and the public site address as environment variables.
- The workflow files.

None of this needs access. I can have it ready and tested locally in Docker before the project exists.

## What I need from you

1. **GCP project**: its ID, billing switched on, and access for whoever runs the setup. If I do it from this machine, `gcloud` signed in as you (or a service account) with Owner on that project is the simple route. Tell me if Dock uses the same project or a separate one.
2. **Domain**: the name, and who controls its DNS. I need to add two or three records, or you add them when I give you the values.
3. **GitHub**: Nafay's OK for the `beryl-*.yml` workflows, and someone with admin on the repo to add two repository variables (project ID and the identity provider's name). You push, as always.
4. **Keys for production**: are the Exa, Claude and Gemini keys in `exa/.env.local` the ones to use in production, or are there separate ones? And a real admin email and password for the live site.
5. **Signing, optional**: an Apple Developer account (99 USD a year) removes the Mac security warning on first launch. Without it the app still works, with two extra clicks the first time. Windows signing costs more and can wait.
6. **A decision**: Cloud Run or a plain VM. And a monthly budget ceiling, so I can set an alert.

## Order of work once I have access

1. Create the project resources (database, bucket, secrets, registry, service account). About an hour.
2. First deploy by hand from this machine, check sign-in, a search, a research run, voice, and a task surviving a reload.
3. Point the domain at it.
4. Turn on the workflows.
5. Build the desktop apps against the real address, upload them, and check a download from the live site on a second machine.
