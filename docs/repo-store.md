# Repository storage and on-demand search

Code questions no longer send hundreds of files to the model. The agent starts from a small
**repo map** and searches the repository **on demand** (`grep`, `list_files`, `read_file`,
`outline_file`, `find_definition`). Citations are verified afterwards against the exact commit.

```
app (web / worker)                                   repository storage
  agent ──▶ search tools ──▶ CodeSource ──┬─▶ LocalGitStore      (in-process: local dev)
                                          └─▶ RemoteRepoStore ──HTTP──▶ repo service ──▶ LocalGitStore
                                                                              │              (cloud)
                                                                              └─▶ archive cache (Cloud Storage)
```

| Module | Role |
| --- | --- |
| `lib/repo-store/git.ts` | runs git hardened: no hooks/fsmonitor/user config, objects validated (`fsckObjects`), https only, no prompts, timeouts, output caps, no shell |
| `lib/repo-store/git-store.ts` | bare repo per GitHub repo; `fetch --depth 1 <sha>` once per commit; cross-process lock; size limit; LRU eviction; archive restore/upload |
| `lib/repo-store/code-source.ts` | `GitSource` (`ls-tree`, `grep`, `cat-file`) and `SnapshotSource` (in-memory, VS Code); secrets, lockfiles, generated files, binaries and dependency dirs are invisible |
| `lib/repo-store/archive-cache.ts` | second-level cache of whole repos: a directory or `gs://bucket/prefix` (JSON API, metadata-server token) |
| `lib/repo-store/service.ts`, `scripts/repo-service.ts` | the repo service (HTTP: `/v1/open`, `/v1/list`, `/v1/grep`, `/v1/read`, `/healthz`), bearer-token protected |
| `lib/repo-store/remote.ts` | client with the same interface as the local store |
| `lib/repo-store/repo-map.ts` | the agent's starting context, built by code and cached per commit |
| `lib/agent/search-tools.ts` | the agent's tools |
| `lib/understanding/explain-search.ts`, `ask.ts` | the on-demand Q&A path and the switch/fallback |

## Security model

- **Nothing in a repository is executed.** Repositories are bare (no working tree), so hooks,
  install scripts, LFS/smudge filters and build steps never run. Running code (tests, builds,
  screenshots of a running app) is a separate, future execution sandbox; it is not this service.
- Access: before using the shared store, the app resolves the branch with the **caller's own GitHub
  token**; a repo the caller cannot read fails there. Tokens are passed per fetch through the
  environment (not argv) and never stored.
- Service-to-service: Cloud Run IAM (Google ID token in `Authorization`) **and** the shared
  `X-Repo-Service-Token`; locally only the token.
- Model input is untrusted: paths are normalized (no absolute paths, no `..`), regexes are POSIX ERE
  with timeouts and result caps, every output is size-limited.

## Running it

**Local, one process (default):** set `GITFILL_SEARCH=agentic`. Repositories go to `storage/repos/`.

**Local, split like the cloud:**

```bash
REPO_SERVICE_TOKEN=dev-token-0123456789 npm run repo-service           # terminal 1 (port 4100)
REPO_SERVICE_URL=http://localhost:4100 REPO_SERVICE_TOKEN=dev-token-0123456789 npm run dev   # terminal 2
```

**Benchmark either mode:** `npm run bench:ask -- <github-url> --mode agentic|snapshot --label <name>`.

## Cloud layout (GCP)

| Piece | Service | Notes |
| --- | --- | --- |
| Web app + worker | Cloud Run `gitfill-web` | `REPO_SERVICE_URL` = the repo service URL, `REPO_SERVICE_TOKEN` from Secret Manager; its service account needs `roles/run.invoker` on `gitfill-repos` (the client sends a Google ID token automatically for https URLs) |
| Repo service | Cloud Run `gitfill-repos` (same image, command `npm run repo-service`) | internal ingress only; 2 vCPU / 4 GiB (the local disk is memory-backed); concurrency ~20; `GIT_STORE_MAX_GB` well below memory |
| Archive cache | Cloud Storage bucket, same region | `REPO_ARCHIVE_CACHE=gs://<bucket>/repos`; the repo service's service account needs `roles/storage.objectAdmin` on the bucket |

Setup sketch:

```bash
gcloud storage buckets create gs://<bucket> --location=<region> --uniform-bucket-level-access
gcloud run deploy gitfill-repos --image <image> --command npm --args run,repo-service \
  --ingress internal --no-allow-unauthenticated --memory 4Gi --cpu 2 \
  --set-env-vars REPO_ARCHIVE_CACHE=gs://<bucket>/repos,GIT_STORE_MAX_GB=2 \
  --set-secrets REPO_SERVICE_TOKEN=repo-service-token:latest
```

A new or restarted repo-service instance restores a repository from the archive (measured: 19 ms for
GitFill) instead of fetching it from GitHub (~1 s). Moving to a VM with a persistent disk later only
changes where `scripts/repo-service.ts` runs.
