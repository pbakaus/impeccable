# Third-Party Notices

This project includes content derived from third-party work, used under the terms of its original license.

## Platform Design Skills

The `skill/reference/ios.md` and `skill/reference/android.md` platform reference files are distilled from ehmo's `platform-design-skills` (Apple Human Interface Guidelines and Material Design 3 rules), rewritten in Impeccable's voice.

**Original work:** https://github.com/ehmo/platform-design-skills
**Original license:** MIT
**Author:** ehmo

## Static HTML parser bundle

`cli/engine/vendor/static-html-parsers.mjs` is a generated bundle of the parser packages the static-HTML detector needs at runtime. Skill and plugin installs copy that file with the detector; they do not install these packages from npm.

| Package | License |
|---|---|
| htmlparser2 | MIT |
| css-select | BSD-2-Clause |
| css-tree | MIT |
| domutils | BSD-2-Clause |
| source-map-js (via css-tree) | BSD-3-Clause |
