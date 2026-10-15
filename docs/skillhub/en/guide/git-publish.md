# Publish a Skill from Git

`publish-git` resolves a public HTTPS Git repository to a commit, packages one selected directory, and submits it through the existing SkillHub publishing workflow. Namespace permissions, package validation, security scanning, and review still apply.

This is a new command in the organization's fork. Its presence here does **not** mean the published npm package `@astron-team/skillhub` includes it. Run the examples from this checkout's `cli/` directory using local source or locally built output.

## Publish from the web

1. Sign in, open Publish Skill, select a namespace and visibility, and choose **Git repository** as the package source.
2. Enter a public GitHub HTTPS repository URL, a branch/tag/full commit (default `HEAD`), and the directory containing `SKILL.md` (`.` for the repository root).
3. Choose **Read and validate repository**. Review the name, version, description, fixed commit, file list, and warnings. This prepares a package without creating a version or completing the security scan.
4. Submit using the existing publish button. Namespace permissions, version conflicts, warning confirmation, scanning, and review use the ordinary upload workflow.

The browser submits the exact ZIP prepared during preview, without resolving the branch again. Changing any source field clears the preview; leaving or refreshing the page discards it. The skill version comes from `SKILL.md`.

Web import supports public `github.com/owner/repository` URLs only. Private credentials, SSH, custom hosts/ports, query strings and `/tree/` URLs are rejected. The server contacts fixed GitHub API/archive hosts without redirects or repository-code execution. Limits: 50 MiB archive, 20 MiB selected content, 10 MiB per file, and 499 source files plus one provenance record (or stricter platform limits). Symlinks, LFS pointers, and conflicting paths are rejected; submodule contents are omitted. Retry later or upload files if GitHub rate-limits requests. Future commits do not sync automatically.

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
