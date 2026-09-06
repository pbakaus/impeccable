# Question dialog fonts

Unmodified upright variable TrueType fonts from google/fonts, pinned at
[`5e35378e6bda803962ee6fd257e444a7d459660d`](https://github.com/google/fonts/tree/5e35378e6bda803962ee6fd257e444a7d459660d).
The full fonts preserve upstream character coverage; no build-time download or
font conversion tool is needed. Combined font size: 264,884 bytes.

| Local file | Upstream path | SHA-256 |
| --- | --- | --- |
| albert-sans.ttf | ofl/albertsans/AlbertSans[wght].ttf | 8fe5d4cf5822d7096d4d17ad781c90f97c745ac13a22be619db74966fba45fda |
| alumni-sans.ttf | ofl/alumnisans/AlumniSans[wght].ttf | 9255d5201c7aba5bf1bde1e8521f0fee691f0588b83f40db228a5f9bbaacfbc4 |

Both fonts use SIL OFL 1.1. The adjacent family-specific OFL notices are copied
from the same upstream revision (whitespace normalized), embedded alongside the
fonts in the engine, and served at `/fonts/<family>-OFL.txt`. The dialog's CSS
documents those license URLs. These third-party font assets retain their own
licenses, independently of the repository's code license.

The dialog requests the same normal-style weight ranges as before: Albert Sans
400–600 and Alumni Sans 100–400. Asset routes are exact allowlists behind the
question server's existing Host validation. No third-party font requests are
made at runtime.
