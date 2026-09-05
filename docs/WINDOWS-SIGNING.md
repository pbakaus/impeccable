# Windows engine signing

Engine releases sign `impeccable.exe` with Azure Artifact Signing before
computing release checksums. The publisher is **Renaissance Geek, Inc.**
Existing release assets are immutable; never replace a shipped unsigned binary
with signed bytes under the same version.

## Access boundary

- Azure account: `impeccable-signing`, East US (`https://eus.codesigning.azure.net/`).
- Public Trust certificate profile: `impeccable-windows`.
- User-assigned managed identity: `impeccable-release-signing`, in the same resource group.
- Its only Azure role is **Artifact Signing Certificate Profile Signer**, scoped
  to `impeccable-signing/certificateProfiles/impeccable-windows`, not the account
  or subscription.
- Federated credential: `github-windows-signing`, issuer
  `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`,
  subject `repo:pbakaus/impeccable:environment:windows-signing`.
- GitHub environment: `windows-signing`, restricted to **tags** matching
  `engine-v*`, with `pbakaus` as required reviewer and administrator bypass off.
  Self-review allows the required reviewer to approve releases they trigger.
- Environment variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and
  `AZURE_SUBSCRIPTION_ID` contain public identifiers, not secrets. No client
  secret, private key, or PFX is stored in GitHub.

## Release and verification

Run the normal `bun run release:engine` flow, then review and approve the
`windows-signing` deployment for that tag in GitHub Actions. Check the tag's
commit and workflow before approving: the environment approval grants that job
the ability to sign as the company.

The build job uploads Windows output as `unsigned-windows-x64`. A separate
Windows runner downloads that artifact from the same run, signs exactly
`impeccable.exe`, and requires a valid Authenticode signature, the expected
publisher, and a timestamp before uploading `impeccable-windows-x64`. That
runner does not check out repository code or execute the downloaded engine.
Only its job receives an OIDC token; only the publish job can write releases.
Publication waits for successful signing and downloads only `impeccable-*`
artifacts, so it cannot package the unsigned intermediate.

RFC 3161 timestamping is required because Azure issues short-lived signing
certificates. Don't pin a leaf certificate thumbprint: Azure rotates them.
If signing or verification fails, fix the cause and retry; don't add an
unsigned fallback or weaken the environment gate.

The workflow configuration is regression-tested by
`bun test tests/release-engine-workflow.test.js`. An actual protected engine
release is still needed to verify Azure OIDC and Authenticode end to end.

References: [Azure signing roles](https://learn.microsoft.com/en-us/azure/artifact-signing/tutorial-assign-roles),
[official signing action](https://github.com/Azure/artifact-signing-action).
