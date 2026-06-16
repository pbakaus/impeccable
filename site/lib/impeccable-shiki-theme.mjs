// Shiki themes mapped to DESIGN.md / site/styles/kinpaku-tokens.css.
// TextMate themes use sRGB hex; each value below is the browser sRGB result
// of the corresponding OKLCH token so design-system detection can match it.

const dark = {
  bg: '#000000',          // lacquer-deep
  fg: '#D7D7D7',          // text
  strong: '#E1E1E1',      // champagne
  muted: '#A4A4A4',       // text-muted
  faint: '#868686',       // text-faint
  gold: '#DDAB46',        // kinpaku-rich
  goldDeep: '#9F7D45',    // kinpaku-deep
  patina: '#68C3BD',      // patina-text
  patinaPale: '#8ED3CC',  // patina-pale
};

const light = {
  bg: '#FDFCF6',          // light-paper-raised
  fg: '#242218',          // light-text
  strong: '#141207',      // light-ink
  muted: '#58554C',       // light-muted
  faint: '#74726A',       // light-faint
  patina: '#146F69',      // patina-deep
  warning: '#B23B1D',     // vermilion-warning-light
  success: '#1D5522',     // success-on-paper
  neutral: '#3A3A3A',     // neutral-35
};

function theme(name, type, colors) {
  return {
    name,
    type,
    colors: {
      'editor.background': colors.bg,
      'editor.foreground': colors.fg,
    },
    tokenColors: [
      {
        scope: [
          'comment',
          'punctuation.definition.comment',
        ],
        settings: {
          foreground: colors.muted,
          fontStyle: 'italic',
        },
      },
      {
        scope: [
          'keyword',
          'storage',
          'storage.type',
          'support.type.property-name',
        ],
        settings: { foreground: colors.patina },
      },
      {
        scope: [
          'string',
          'constant.other.symbol',
          'markup.inline.raw.string',
        ],
        settings: { foreground: colors.success || colors.patinaPale },
      },
      {
        scope: [
          'constant.numeric',
          'constant.language',
          'constant.character',
          'variable.language',
        ],
        settings: { foreground: colors.warning || colors.gold },
      },
      {
        scope: [
          'entity.name.function',
          'support.function',
          'variable.function',
        ],
        settings: { foreground: colors.strong },
      },
      {
        scope: [
          'entity.name.tag',
          'support.class.component',
          'entity.name.type',
          'entity.other.attribute-name',
        ],
        settings: { foreground: colors.goldDeep || colors.gold || colors.patina },
      },
      {
        scope: [
          'variable',
          'meta.object-literal.key',
          'support.variable',
          'support.constant',
        ],
        settings: { foreground: colors.patinaPale || colors.neutral },
      },
      {
        scope: [
          'punctuation',
          'meta.brace',
          'meta.delimiter',
          'keyword.operator',
        ],
        settings: { foreground: colors.faint },
      },
      {
        scope: [
          'markup.heading',
          'markup.bold',
          'entity.name.section',
        ],
        settings: {
          foreground: colors.strong,
          fontStyle: 'bold',
        },
      },
      {
        scope: [
          'markup.italic',
          'markup.quote',
        ],
        settings: {
          foreground: colors.muted,
          fontStyle: 'italic',
        },
      },
    ],
  };
}

export const impeccableShikiThemes = {
  light: theme('impeccable-kinpaku-light', 'light', light),
  dark: theme('impeccable-kinpaku-dark', 'dark', dark),
};
