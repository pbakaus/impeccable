# Third-Party Notices

This project includes content derived from third-party work, used under the terms of its original license.

## Platform Design Skills

The `skill/reference/ios.md` and `skill/reference/android.md` platform reference files are distilled from ehmo's `platform-design-skills` (Apple Human Interface Guidelines and Material Design 3 rules), rewritten in Impeccable's voice.

**Original work:** https://github.com/ehmo/platform-design-skills
**Original license:** MIT
**Author:** ehmo

## Fonts in the browser extension

The browser extension ships two fonts under `extension/fonts/`, each with its licence text beside it.

**Albert Sans** (`albertsans.ttf`)
**Original work:** https://github.com/usted/Albert-Sans
**Original license:** SIL Open Font License 1.1 (`albertsans-OFL.txt`)
**Copyright:** 2021 The Albert Sans Project Authors

**Alumni Sans** (`alumnisans.ttf`)
**Original work:** https://github.com/googlefonts/alumni
**Original license:** SIL Open Font License 1.1 (`alumnisans-OFL.txt`)
**Copyright:** 2015 The Alumni Sans Project Authors

## Consent rules in the browser extension

The browser extension's journeys answer cookie and consent banners with DuckDuckGo's autoconsent: its engine and rule set, unmodified, ship in `extension/walks/consent-rules.js` behind a small bridge of our own.

**Original work:** https://github.com/duckduckgo/autoconsent (its `dist/autoconsent.playwright.js` and `rules/compact-rules.json`, at the version named on the first line of `consent-rules.js`)
**Original license:** Mozilla Public License 2.0, https://mozilla.org/MPL/2.0/ (the whole of `consent-rules.js`, our bridge included; the rest of this repository is Apache-2.0)
**Copyright:** DuckDuckGo, Inc.
