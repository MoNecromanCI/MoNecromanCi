# Plugin needs

What the MoNecromanCI editor extension needs from you (design assets and accounts) before it can be published. Everything the extension itself needs in code, I build; this file is only what I cannot make or sign up for.

Issue: [#280](https://github.com/MoNecromanCI/MoNecromanCi/issues/280). First target: VS Code (and, through Open VSX, Cursor, Windsurf and the other forks).

## Brand reference

From `assets/logo.svg` (a dark disc with eight radiating arms):

| Role | Colour |
|---|---|
| Core (the disc) | `#261515` |
| Green | `#2ECC71` |
| Orange | `#FF8A00` |
| Red | `#FF002A` |
| Purple | `#7020D0` |

`assets/Curve.png` is 1024 × 1024 RGBA; it can serve as the source for the raster icon below if it is the shape you want.

## Design assets to create

### 1. Extension icon (the Marketplace and Open VSX listing, the Extensions view)

- **Format:** PNG. The Marketplace rejects SVG for this icon.
- **Size:** 256 × 256 px (128 × 128 is the minimum; 256 stays sharp on high-DPI screens). Square, no rounded corners baked in.
- **Look:** the full-colour logo on a transparent or solid background. It is shown on both light and dark listings, so it must read on white *and* on near-black: if the disc is `#261515` on a transparent background, it disappears on dark themes. Give it a solid light or coloured plate behind it, or keep a light outline.
- **File:** `images/icon.png`.

### 2. Side bar (Activity Bar) icon: the one in your sketch

This is the icon in the left-hand strip that opens the "MNCI Console".

- **Format:** SVG, single path or shapes, **one colour, no gradients, no strokes you rely on for colour**. VS Code ignores the colour and paints the icon itself, white-ish when selected and dimmed when not, so only the *shape* counts.
- **Size:** `viewBox="0 0 24 24"`, drawn so the glyph fits in roughly 20 × 20 inside it (2 px of padding). It is shown at 24 px, sometimes smaller.
- **Look:** a simplified mark of the logo, not the whole thing: the disc with the eight arms reduced to a clean silhouette. It must stay recognisable at 16 px and must not depend on colour to be understood, as it is rendered in a single flat colour. Keep line weights ≥ 1.5 px at the 24 px size.
- **Fill:** use `fill="currentColor"` (or any single colour; it is overridden).
- **File:** `images/activity-bar.svg`.

### 3. Group icons for the tree (optional: I fall back to built-in icons without them)

VS Code ships a set of icons (Codicons), and I'll use those by default (`rocket`, `package`, `gear`, `pulse`, `tools`). Only make these if you want a distinct look:

- Five small mono icons for the groups: Workspace, Projects, Dependencies, Pipeline, Info.
- **Format/size:** SVG, `viewBox="0 0 16 16"`, single colour, same rules as the side bar icon. Place in `images/group-<name>.svg`.

### 4. Language icons for the "Add project" picker (optional)

The picker groups the kinds by language: TypeScript, Python, Go, Flutter and C#. Their official logos are brand assets of those projects; unless you want to draw your own, I'll use plain text labels with Codicons and no logos.

- If you do want icons: SVG, `viewBox="0 0 16 16"`, colour allowed (these are shown beside the item, not tinted). Place in `images/lang-<language>.svg`.

### 5. Listing banner colour and theme

Not a file: two values for the listing header.

- **Colour:** I propose `#261515` (the logo core) with the dark theme. Tell me if you prefer one of the accents.

### 6. README screenshots and a short GIF (for the listing page)

Taken from the finished extension, so these come last.

- 3 to 5 PNGs, **1600 × 900** (16:9), under 1.5 MB each, in a dark and a light theme: the side bar, the "Add project" picker, the Doctor results in the Problems panel.
- One optional GIF (max 1000 px wide, under 5 MB) of "create a workspace, add a project".
- Put under `images/screenshots/`.

### 7. Walkthrough images (optional)

If you want the first-run "Get started" walkthrough to have pictures: SVG or PNG, about **800 × 450**, one per step, with a light and a dark variant.

## Accounts and publishing

The extension is published to two registries. Neither can be done for you, because each needs an account signed in your name.

### VS Code Marketplace (what VS Code itself uses)

1. **Microsoft account.** Any personal or work Microsoft account.
2. **Azure DevOps organization.** Go to <https://dev.azure.com> and create one (free). The Marketplace uses it only for identity and access tokens.
3. **Create the publisher.** At <https://marketplace.visualstudio.com/manage>, choose *Create publisher*.
   - **ID (this is the "user id" you asked about):** the unique, permanent identifier. It goes in the extension's `package.json` as `"publisher"` and in the URL (`marketplace.visualstudio.com/items?itemName=<publisher>.<extension>`). **It cannot be changed later**, so choose it carefully: I'd suggest `monecromanci`.
   - **Name:** the display name shown on the listing (can be changed later). For example *MoNecromanCI*.
4. **Credential for CI.** Two routes, both already supported by mnci's release step (`tools/vscode-extension.cjs`):
   - **Personal Access Token (simplest).** In Azure DevOps: *User settings → Personal access tokens → New token*. Organization: **All accessible organizations**. Scope: *Marketplace → Manage*. Store it as the repository secret `VSCE_PAT`. Tokens expire (up to a year), so note the date.
   - **Microsoft Entra ID (no long-lived secret).** Set the repository variable `AZURE_CLIENT_ID` and an OIDC federated credential; the GitHub release step then sets `VSCE_AUTH=entra`. More set-up, nothing to rotate.
5. **Optional: verified publisher badge.** Needs a domain you own (a DNS TXT record). Not required to publish.

### Open VSX (Cursor, Windsurf, VSCodium, and other forks)

1. **Eclipse account** at <https://accounts.eclipse.org> (with a GitHub username linked).
2. **Sign the Publisher Agreement** at <https://open-vsx.org> (log in with GitHub; open your profile and sign it).
3. **Create the namespace** with the same name as the publisher ID (so the extension id is identical in both registries): `npx ovsx create-namespace <publisher> -p <token>`.
4. **Access token** from the open-vsx.org profile page; store as the secret `OVSX_PAT`.

(What I add on my side: an `ovsx publish` step next to the Marketplace one in the release workflow, once you have the namespace and the token.)

### What I need back from you

- The publisher ID you chose (I'll pass it as `mnci add vscode-extension --publisher <id>`).
- Which credential route you picked for the Marketplace (PAT or Entra).
- The secrets set in the repository: `VSCE_PAT` (or the Entra variable) and `OVSX_PAT`.
- The asset files above, at the paths given.

Everything else (extension code, commands, tests, packaging, the release workflow) I build and verify myself. Until the assets exist, the extension ships with a placeholder icon so nothing is blocked.
