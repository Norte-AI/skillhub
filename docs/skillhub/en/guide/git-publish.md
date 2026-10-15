# Publish a Skill from Git

`publish-git` resolves a public HTTPS Git repository to a commit, packages one selected directory, and submits it through the existing SkillHub publishing workflow. Namespace permissions, package validation, security scanning, and review still apply.

This is a new command in the organization's fork. Its presence here does **not** mean the published npm package `@astron-team/skillhub` includes it. Run the examples from this checkout's `cli/` directory using local source or locally built output.

## Publish from the web

1. Sign in, open Publish Skill, select a namespace and visibility, and choose **Git repository** as the package source.
2. Enter an enabled provider HTTPS repository URL, a branch/tag/full commit (default `HEAD`), and the directory containing `SKILL.md` (`.` for the repository root).
3. Choose **Read and validate repository**. Review the name, version, description, fixed commit, file list, and warnings. This prepares a package without creating a version or completing the security scan.
4. Submit using the existing publish button. Namespace permissions, version conflicts, warning confirmation, scanning, and review use the ordinary upload workflow.

The browser submits the exact ZIP prepared during preview, without resolving the branch again. Changing any source field clears the preview; leaving or refreshing the page discards it. The skill version comes from `SKILL.md`.

Web import defaults to public GitHub and supports operator-enabled GitLab plus user/repository-scoped credential aliases. SSH, request-selected API hosts, custom ports, query strings and `/tree/` URLs are rejected. The server contacts fixed operator-configured API/archive hosts without following redirects or executing repository code. Limits: 50 MiB archive, 20 MiB selected content, 10 MiB per file, and 499 source files plus one provenance record (or stricter platform limits). Symlinks, LFS pointers and conflicting paths are rejected. Saved Git sources can be synchronized manually or through explicitly enabled polling and authenticated webhooks, described below.

## Prerequisites

Install Git and a supported Bun runtime, then install the CLI dependencies. Prepare a publicly readable HTTPS repository, a Skill directory containing a valid `SKILL.md`, and credentials with publishing permission in the target namespace. Skill metadata and version must satisfy the existing package rules.

Always pass `--registry` to select the intended registry. Private repositories, SSH/local repository URLs, submodules, and symbolic links are outside this first implementation. Repository URLs must not include credentials, query strings, or nonstandard ports. Redirects, Git hooks, checkout filters, and automatic Git LFS downloads are disabled; include required files as ordinary tracked Git files. For web import, use the workflow above; CLI support and limits differ. Git retrieval runs on the CLI machine; the registry receives an ordinary Skill package. Limits are 499 tracked files (plus one generated source record), 10 MiB per file, and 100 MiB of total package content including provenance (retrieval reserves 8 KiB for it); Git transfer is capped at 256 MiB and 60 seconds.

## Validate before publishing

```bash
cd cli
bun install --frozen-lockfile
bun run src/index.ts publish-git https://github.com/example/team-skills.git \
  --ref main \
  --subdir skills/code-review \
  --namespace team \
  --registry https://skillhub.example.com \
  --visibility public \
  --dry-run \
  --json
```

Replace the example repository, directory, namespace, and registry. Dry-run retrieves Git content and calls the target registry's validation endpoint; it requires network access and authentication, but does not create a published version.

After checking the result, omit `--dry-run` to submit:

```bash
bun run src/index.ts publish-git https://github.com/example/team-skills.git \
  --ref main \
  --subdir skills/code-review \
  --namespace team \
  --registry https://skillhub.example.com \
  --visibility public \
  --json
```

Alternatively, run `bun run build` and invoke `node dist/index.js publish-git ...`. Use the existing registry-specific login or `SKILLHUB_TOKEN` credential mechanism. Do not put real tokens in source repositories, examples, or logs.

## Reproducible source

`--ref` accepts a branch, tag, or commit SHA and defaults to `HEAD`. `--subdir` defaults to the repository root (`.`), namespace to `global`, and visibility to `public`. Explicitly select your directory, namespace, and registry. Branches and tags resolve to a concrete commit before packaging. The resulting package includes `.skillhub-source.json` with immutable commit provenance. The source record is `{schemaVersion: 1, repository, requestedRef, commit, subdir}`, where `commit` is the full resolved commit SHA (normally 40 characters, or 64 in SHA-256 repositories). A source directory already containing `.skillhub-source.json` is rejected rather than overwritten. The Skill version still comes from the existing `SKILL.md`; this command does not rewrite it.

An existing published version does not change when its upstream branch moves; later changes require a new Skill version.

For release reproducibility, prefer a full commit SHA:

```bash
bun run src/index.ts publish-git https://github.com/example/team-skills.git \
  --ref 0123456789abcdef0123456789abcdef01234567 \
  --subdir skills/code-review \
  --namespace team \
  --registry https://skillhub.example.com \
  --visibility public
```

The example SHA is a placeholder. Select one Skill directory with `--subdir`, rather than a parent containing multiple independent Skills.

## Review and installation

Use the returned version and workflow state to check scanning and review in the registry. A successful submission is not proof of public installability: namespace policy and review determine final visibility.

Once approved, users discover and install the version through existing registry workflows. The packaged source record supports traceability; it is not a security certification. See [Publishing](./skill-publish), [Review](./review), and the [CLI guide](./cli).

## Troubleshooting

- **Repository access fails:** verify anonymous HTTPS access; private, SSH, and local sources are unsupported.
- **Ref or directory missing:** check the selected commit and its Skill directory.
- **Submodules rejected:** include required files directly in the source repository.
- **Validation fails:** fix the reported metadata, paths, or package limits and repeat dry-run.
- **Duplicate version:** publish a new Skill version instead of overwriting an existing release.
- **Unauthorized:** check the registry URL, its credentials, and namespace permissions.

Dry-run and publication independently resolve refs. To publish exactly the validated snapshot, copy the returned `source.commit` into the final command's `--ref`; a branch name may move between the two commands.


## Configured providers, private credentials and source sync

The web importer defaults to public GitHub. Operators can enable an exact GitLab host with `skillhub.git.providers.[gitlab.com].kind=GITLAB`, and fixed `api-base` / `archive-base` values of `https://gitlab.com/api/v4`. Nested GitLab groups are supported. Hosts are operator configuration, never request-selected API hosts; redirects are rejected. The Chinese guide above contains a complete YAML example.

Private access uses operator-managed credential aliases under `skillhub.git.credentials`: each alias has `token`, an exact canonical `repository` ending in `.git`, and an explicit `user-ids` allowlist. Browser requests select `credentialId` only. Tokens are sent in headers (`PRIVATE-TOKEN` for GitLab, `Authorization: Bearer` for GitHub), never URLs, manifests or returned errors. The options endpoint returns only aliases authorized for the current user. Private GitLab and GitHub auth and pinned snapshots are tested with an isolated fake-provider transport; real external private-repository acceptance requires organization credentials.

The Git sources dashboard stores repository/ref/subdirectory, namespace, visibility and credential alias in PostgreSQL. Creating a source does not publish. Manual sync resolves the configured ref to a full commit, imports that snapshot and invokes the existing scan/review publishing workflow as the source owner with current membership checks and without administrator direct-publish privileges. New warnings require manual confirmation through the regular importer. Unchanged successful commits are no-ops; new commits require new SKILL.md versions. Version conflicts never overwrite immutable versions. Errors retain the previous successful commit and record a sanitized FAILED status.

Only the creator can list/manage a source or rotate its webhook key. Each user can configure up to 20 sources. A database lease prevents overlapping syncs; deletion waits for active syncs. A crashed worker's lease expires after three minutes. If publication succeeded immediately before a crash, retry can hit immutable-version rejection instead of silently publishing again; check the submitted version and then use a new version. Disabling a source prevents new sync runs; a run already started can finish.

Automatic polling is globally disabled by default (`skillhub.git.automatic-sync-enabled=false`). Once enabled, individual sources also need `autoSync=true`; the task checks up to ten due sources per minute with at least fifteen minutes between checks, including failed attempts.

For webhooks, set a random operator master secret of at least 32 characters in `skillhub.git.webhook-secret`. The source owner generates/rotates a source-specific key from the dashboard. The key is returned only by that operation, not source listings. Configure it as GitHub's Secret (native raw-body `X-Hub-Signature-256` HMAC-SHA256) or GitLab's Secret token (native `X-Gitlab-Token`); comparisons are constant-time. Keys are derived from the operator secret and a rotating database nonce, not stored in plaintext. Payloads are limited to 64 KiB and are wake-up signals only: configured repository/ref are independently resolved. Duplicate deliveries use commit idempotency; rotation invalidates old keys. Localhost cannot receive callbacks from external hosting providers: local signed-request tests are supported, while actual external hooks require a reachable HTTPS deployment outside this local-delivery scope.


Private GitHub imports use fixed Git Trees and Git Blobs API requests instead of redirect-based private archive URLs. Raw blobs use the official `application/vnd.github.raw+json` media type. Tree metadata is capped at 2 MiB; truncated trees are rejected. File retrieval checks a 90-second total deadline before starting each request; a started request can take up to another 30 seconds under its body deadline. The same 499-file, 20 MiB total, 10 MiB per-file, path and object-mode restrictions apply. See [Git Trees](https://docs.github.com/en/rest/git/trees) and [Git Blobs](https://docs.github.com/en/rest/git/blobs). Large trees or many files may require ZIP upload.
