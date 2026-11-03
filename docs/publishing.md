# Publishing the extension

The extension is ready to be published on the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/vscode) (used by VS Code) and on
[Open VSX](https://open-vsx.org) (used by VSCodium, Gitpod, Eclipse Theia, Cursor and other
VS Code forks). It is on the Visual Studio Marketplace since version 0.5.1, not yet on Open VSX. This
page lists the one-time setup and the steps for each release.

The extension ID is `veratech-es.vscode-fhir-connect`: the `publisher` field of `package.json`
(`veratech-es`) must match the publisher on the Marketplace and the namespace on Open VSX.

## What is already in the repository

| Requirement | Where |
| --- | --- |
| Icon, PNG, at least 128×128 (ours is 256×256) | `images/icon.png`, `"icon"` in `package.json` |
| Name, description, categories, keywords | `displayName`, `description`, `categories`, `keywords` in `package.json` |
| Banner colour of the Marketplace page | `galleryBanner` in `package.json` |
| License | `LICENSE` (Apache-2.0), `"license"` in `package.json` |
| Repository, issues and home page links | `repository`, `bugs`, `homepage` in `package.json` |
| Marketplace page | `README.md`; no SVG images (the Marketplace rejects them) |
| Change log tab | `CHANGELOG.md` |
| Small package | `.vscodeignore` leaves out sources, tests, fixtures and `node_modules`; the code is bundled by esbuild into `dist/` |

Relative links in `README.md` (for example `docs/user-guide.md`) are rewritten by `vsce` to point to
the files on GitHub (`https://github.com/veratech-es/vscode-fhir-connect/blob/HEAD/...`), so they
work on the Marketplace as long as the repository stays public.

`npm run package` must finish with no warnings. Check the list of files it prints: only `dist/`,
`docs/` (except this page), `images/icon.png`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE` and `NOTICE`
should be in it.

## One-time setup: Visual Studio Marketplace

1. **Microsoft account.** Sign in at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
   with the account that will own the extension (preferably a Veratech account rather than a
   personal one, and add other people as members later).
2. **Create the publisher.** On that page, *Create publisher*. The **ID must be `veratech-es`**
   (it cannot be changed later); the display name can be *Veratech for Health*. Fill in the
   company web site and logo if you want them on the publisher page.
3. **Personal Access Token (PAT).** The `vsce` tool authenticates with an Azure DevOps token:
   1. Go to [dev.azure.com](https://dev.azure.com) with the same Microsoft account and create an
      organization if you do not have one (any name; it is only needed to issue the token).
   2. *User settings* (icon next to your avatar) → *Personal access tokens* → *New Token*.
   3. *Organization*: **All accessible organizations** (a token for a single organization fails
      with a 401 error).
   4. *Expiration*: up to one year; write the date down, the token must be renewed.
   5. *Scopes*: **Custom defined** → *Show all scopes* → **Marketplace** → tick **Manage**.
   6. *Create* and copy the token. It is shown only once. Keep it in a password manager, never in
      the repository.
4. **Log in with vsce** (stores the token on this computer):

   ```shell
   npx vsce login veratech-es
   ```

   Paste the token when asked.

If Microsoft has retired PATs for the Marketplace by the time you publish, `vsce publish` also
accepts Microsoft Entra ID credentials with `--azure-credential`; see the official
[Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
page.

## One-time setup: Open VSX

1. Sign in at [open-vsx.org](https://open-vsx.org) with a GitHub account.
2. Link an [Eclipse account](https://accounts.eclipse.org) in your Open VSX profile (create one if
   needed; the GitHub user name must be filled in on the Eclipse account) and sign the
   **Eclipse Foundation Open VSX Publisher Agreement** from the profile page.
3. *Settings* → *Access Tokens* → *Generate New Token*. Copy it; it is shown only once.
4. Create the namespace, which must be the same as the publisher:

   ```shell
   npx ovsx create-namespace veratech-es -p <open-vsx-token>
   ```

   Optionally, ask for the namespace to be verified (a GitHub issue on
   [EclipseFdn/open-vsx.org](https://github.com/EclipseFdn/open-vsx.org/issues)), so the
   extension is shown as coming from the verified owner.

## Each release

1. Make sure `main` is up to date and the checks pass:

   ```shell
   npm ci
   npm run typecheck
   npm test
   ```

2. Set the new version in `package.json` (for example `npm version 0.6.0 --no-git-tag-version`) and
   turn the *Unreleased* heading of `CHANGELOG.md` into that version with the date. The Marketplace
   and Open VSX reject a version that was already published.
3. Build the package once and check it:

   ```shell
   npm run package
   ```

   No warnings, and the file list as above. Install the `.vsix` locally and try it.
4. Commit, merge to `main` and tag the release (`git tag v0.6.0 && git push origin v0.6.0`). The
   *Release* workflow (`.github/workflows/release.yml`) then builds the `.vsix` again, checks that
   the tag matches the version of `package.json`, and creates the GitHub release with the `.vsix`
   attached and the section of that version in `CHANGELOG.md` as notes. Instead of pushing the tag,
   you can run the workflow by hand (*Actions* → *Release* → *Run workflow*) with the tag and,
   optionally, the commit to build; it creates the tag on that commit.
5. Publish the same `.vsix` to both registries:

   ```shell
   npx vsce publish --packagePath vscode-fhir-connect-0.6.0.vsix
   npx ovsx publish vscode-fhir-connect-0.6.0.vsix -p <open-vsx-token>
   ```

   Publishing the file built in step 3 makes sure both registries get exactly what was tested.
   (`npm run package` already passes `--no-dependencies`, because the code is bundled in `dist/`.)
6. The Marketplace verifies the package for a few minutes before the new version appears at
   `https://marketplace.visualstudio.com/items?itemName=veratech-es.vscode-fhir-connect`. Open VSX
   shows it at once at `https://open-vsx.org/extension/veratech-es/vscode-fhir-connect`.

To withdraw a version, `npx vsce unpublish veratech-es.vscode-fhir-connect` removes the whole
extension from the Marketplace (it cannot be undone and the version numbers stay used); it is
usually better to publish a fixed version.

## Optional, before the first release

- Add `"preview": true` to `package.json` to show a *Preview* badge while the extension is young.
- Remove the *(unreleased)* marks from the `CHANGELOG.md` headings that were never published, or
  merge them into the first public version.
- Replace the build-from-source instructions in the user guide's *Install* section by the
  Marketplace link once the extension is live.
