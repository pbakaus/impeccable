---
tagline: "Fix typography that feels generic, inconsistent, or accidental."
---

## When to use it

Reach for `/impeccable typeset` when the text on a page looks like default typography instead of designed typography. Muddy hierarchy, three sizes that look the same, body copy at 14px, a display font that is actually just Inter bold, headlines with no kerning attention.

Common triggers: "hierarchy feels flat", "readability is off", "fonts look generic".

## How it works

The skill assesses typography across five dimensions:

1. **Font choices**: are you using invisible defaults (Inter, Roboto, Arial, Open Sans), does the typeface match the brand, are there more than 2 to 3 families.
2. **Hierarchy**: are heading, body, and caption clearly different at a glance, is the size contrast at least 1.25x between steps, are weight contrasts legible.
3. **Sizing and scale**: is there a coherent type scale, does body text meet 16px minimum, is the scale fixed-rem for app UIs or fluid-clamp for marketing pages.
4. **Readability**: line length 45 to 75 characters, line-height tuned for font and context, contrast.
5. **Consistency**: same element uses same treatment everywhere, no one-off font-size overrides.

It then fixes what it finds: picks distinctive typefaces, builds a modular scale, widens hierarchy contrast, sets proper line length and leading.

## Try it

```
/impeccable typeset the article layout
```

Expected diff:

- Display font swapped from Inter 700 to a real display face
- Type scale rebuilt: 3rem / 2rem / 1.25rem / 1rem / 0.875rem, ratio 1.333
- Body text bumped from 14px to 16px
- Line length clamped to 68ch on the article column
- Line-height 1.6 for body, 1.1 for display
- Removed four one-off `font-size` values scattered in component styles

## Pitfalls

- **Asking for a new font without context.** Typeset will pick based on the `PRODUCT.md` brand voice. If you have not run `/impeccable teach`, the suggestion will be generic.
- **Reaching for typeset when the issue is layout.** If paragraphs are fine but the page feels cramped, you want `/impeccable layout`.
- **Expecting fluid clamp scales on app UIs.** Typeset uses fixed rem scales for app interfaces. Fluid typography is for marketing and content pages where line length varies dramatically.
