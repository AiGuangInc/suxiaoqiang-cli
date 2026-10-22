# Repository working agreements

## CLI publication

- Publish through a release PR. Keep `package.json`, `package-lock.json` (including
  `packages[""].version`), and `.github/release.json.version` consistent, and include
  nonempty release notes. Merging the PR into `main` with a change to
  `.github/release.json` triggers `.github/workflows/publish-npm.yml`.
- GitHub Actions owns npm publication through trusted publishing in the
  `npm-publish` environment. Local npm login and local npm tokens are unrelated to
  this path; do not use local publication as a fallback.
- Before changing authentication or release code, read the failing Actions step
  and its HTTP response. Check the npm service status at
  https://status.npmjs.org/ when registry requests fail or time out.
- npm OIDC token exchange can return HTTP 503 during a service outage, after which
  npm reports `ENEEDAUTH`. That message alone does not prove that trusted
  publishing is misconfigured. Use the exchange response and Actions permissions
  as evidence; enable verbose logging for diagnosis only when needed.
- For an upstream outage, report the cause, wait for recovery, then rerun the
  original failed Actions job after checking whether the version is already
  published. Keep the normal release workflow simple: do not add incident-specific
  retry loops, compatibility branches, temporary release entry points, or permanent
  verbose logging. Do not refresh local credentials for an Actions failure.
- Preserve existing release tags and published package contents. Package fixes
  require a new version and release PR; never move a release tag to retry.
- A successful publish command is not full acceptance. Verify the exact version
  from the public npm registry, install it in isolation, exercise the changed
  behavior through `sxq`, and clean up acceptance fixtures. Publish and verify
  both documentation sites after package acceptance.
