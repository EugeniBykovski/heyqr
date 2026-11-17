# Git workflow and Jira integration

## Branches

One branch per Jira ticket, created from `main`:

```
HEY-<number>-<short-kebab-description>
HEY-12-frame-gallery
```

Never commit to `main` directly; never force-push `main`. Merge through a pull request with green CI.

## Commits

[Conventional Commits](https://www.conventionalcommits.org) with the Jira key as the scope:

```
<type>(HEY-<number>): <description>
feat(HEY-12): add frame gallery to the design step
fix(HEY-23): keep query string on dynamic redirects
```

Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `style`, `revert`.

- `commitlint` (commit-msg hook) rejects a commit without a `HEY-<n>` scope.
- The `prepare-commit-msg` hook adds the key from the branch name when you omit it:
  on branch `HEY-12-frame-gallery`, `feat: add frames` becomes `feat(HEY-12): add frames`.
- `lint-staged` formats and lints staged files on commit.

Pull request title: `HEY-<number> — <Ticket title>`.

## Showing branches and commits in Jira

Jira links development work by finding the issue key (`HEY-12`) in branch names, commit messages and
PR titles. Enable it once:

1. Jira → Apps → Explore more apps → install **GitHub for Jira** (by Atlassian).
2. In the app, connect the GitHub organization/user `EugeniBykovski` and select the `heyqr` repository.
3. Open any ticket: the **Development** panel now lists branches, commits, PRs, builds and deployments.
4. Optional: Jira → Project settings → Automation → “When a branch is created → transition to In Progress”,
   “When a PR is merged → transition to Done”.

Existing history is backfilled after connecting; new pushes appear within seconds.
