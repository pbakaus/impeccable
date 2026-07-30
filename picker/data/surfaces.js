/*
  The four kinds of surface a design system can be asked to serve, straight from
  the skill's modes, and the questions that are answered once for each of them.

  Values travel as `surface-modes` (multi-select) from screen 01b; the agent
  pre-checks what PRODUCT.md suggests via cues.json, and the visitor corrects
  it. Persuade is the markup default so the answer can never arrive empty on
  runs whose cues carry no hint.
*/
export const SURFACE_MODES = ['persuade', 'operate', 'read', 'experience'];

/*
  A question listed here is answered once per chosen surface rather than once
  per run, because the answer that suits the marketing page rarely suits the
  tool it sells. Each entry carries:

  - `allow`, the options that surface can take. Anything left out stays in the
    list, turned off, with the option's own `data-blocked-reason` in place of
    its description. Whether an option is out belongs to the option and not to
    the pairing, so the reason is written once beside the copy it replaces.
    Omitted where the question rules nothing out, which is not the same as
    listing nothing, so the attribute is left off rather than left empty.
  - `fallback`, what the surface lands on when nobody ever opens its tab. Every
    chosen surface leaves an answer, so every surface needs one. Omitted where
    the options are not known until the run deals them, and the first row on
    the list stands in.
  - `answered` and `unanswered`, what the tab tells a screen reader. `{}` is
    where the chosen option's own label goes, lowercased so it reads as part of
    the sentence around it. `properName` turns that off for a question whose
    options are named after something rather than described.
  - `flat`, for a question the tabs exist to protect rather than to split. The
    per-surface reading is still kept while the screen is open, so an option a
    surface rules out cannot be the answer left behind, but only the leading
    surface's choice is written down. A key per surface would promise whoever
    reads the answers a distinction the run has nowhere to spend.

  A question that leaves a surface out of `surfaces` is not asked of that
  surface at all, which is a stronger statement than withholding an option from
  it. Withholding says the surface would answer this badly; leaving it out says
  the surface has no stake in the question. So the tab strip only offers the
  surfaces the question names, and a run whose surfaces are all left out never
  sees the screen and records no answer for it. Only motion is scoped that way
  today; the rest name all four.

  Persuade is allowed everything on every question: earning attention is the
  whole job of the surface, and no answer here is too much for it. The other
  three are ruled by what the surface is for rather than by how loud an option
  is. A tool has to stay scannable, which rules out the loudest answers and,
  on boundaries, the emptiest one as well. A page read at length is one plane
  and one column. On a portfolio the work leads, so it is the interface that
  has to recede; the page itself is still allowed to be dramatic, which is why
  drenched survives there and four working colors do not.
*/
export const SURFACE_ANSWERS = {
  'color-strategy': {
    tablist: 'Surface being colored',
    answered: 'colored {}',
    unanswered: 'no color strategy chosen yet',
    surfaces: {
      persuade: { allow: 'restrained committed full-palette drenched', fallback: 'committed' },
      operate: { allow: 'restrained committed full-palette', fallback: 'restrained' },
      read: { allow: 'restrained committed full-palette', fallback: 'restrained' },
      experience: { allow: 'restrained committed drenched', fallback: 'restrained' },
    },
  },

  /*
    Flat, and the only question here that rules nothing out. There is no pair
    that suits a landing page and is forbidden on a dashboard; a pair that fails
    the dashboard is a bad pair, and the model composing fonts.json is told to
    rank all six against the strictest surface the run names. So no allow list
    is written, and every row stays live on every tab.

    The tabs earn their place all the same. One pair is chosen and one type
    system comes out of the run, and the thing a visitor cannot otherwise do is
    see that pair set as a dashboard, as a document, and as an index before
    committing to it. The strip here is a way of looking rather than a second
    decision.
  */
  'font-pair': {
    tablist: 'Surface the pair is shown on',
    answered: 'set in {}',
    unanswered: 'no pair chosen yet',
    properName: true,
    flat: true,
    surfaces: {
      persuade: {},
      operate: {},
      read: {},
      experience: {},
    },
  },

  /*
    The one question that is not put to every surface. Motion energy is a claim
    on attention, and only two of the four surfaces are in a position to make
    one: a landing page earning a decision and a portfolio presenting work. A
    tool and a document are moved through rather than watched, and their motion
    follows from what the interface is doing rather than from a house style, so
    asking them would collect an answer nothing should act on. An app-UI-only or
    docs-only run therefore never reaches this screen.

    Both surfaces that are asked can take all three energies, so nothing is
    withheld and no option carries a reason. Their defaults differ, because what
    a surface does with movement when nobody says otherwise is the whole of what
    it is for: a page earning a decision has to answer the pointer it is trying
    to keep, and a portfolio stages the work's arrival, which is what a reveal
    is for.
  */
  'motion-energy': {
    tablist: 'Surface being moved',
    answered: '{} movement',
    unanswered: 'no motion energy chosen yet',
    surfaces: {
      persuade: { fallback: 'responsive' },
      experience: { fallback: 'choreographed' },
    },
  },

  /*
    Flat, and the tabs here are worth having anyway. The twelve-column ruler on
    this screen describes a page, and it describes one whether the run ships a
    dashboard or a gallery, so the answer stays one value that every screen
    after it inherits. What the tabs buy is the chance to say that a surface
    cannot take an answer before it is chosen for it.

    Freeform is out on the two surfaces you come back to. A block that has
    left the grid is found by looking rather than by habit, and habit is what
    a tool and a long document are read with: the sidebar was there last time,
    the callout sat against the same measure a page ago. Persuade and the
    portfolio keep it, because a page seen once has nothing to remember.

    The two disciplined answers are kept by all four, even though the probe
    showed them only a few points apart on a dashboard. What is being chosen
    between them is which spans the page spends its columns on, and that is a
    decision a tool makes as much as a landing page does; ruling one out for
    being quiet would buy nothing.

    Persuade lands on the aligned grid with breaks in it: a page earning a
    decision needs one block to lead, and that is what the breaks are for.
    The other three land on the even grid, for the reason each of them is
    ruled by. A tool wants the layout predictable, a document is one column
    and one rhythm, and a gallery hangs work square so the only irregular
    edges on the page are the work's own.
  */
  'layout-structure': {
    tablist: 'Surface being laid out',
    answered: '{} layout',
    unanswered: 'no layout structure chosen yet',
    flat: true,
    surfaces: {
      persuade: { allow: 'simple-grid balanced freeform', fallback: 'balanced' },
      operate: { allow: 'simple-grid balanced', fallback: 'simple-grid' },
      read: { allow: 'simple-grid balanced', fallback: 'simple-grid' },
      experience: { allow: 'simple-grid balanced freeform', fallback: 'simple-grid' },
    },
  },

  /*
    Open space is out on a tool. Operate asks for a ground of its own under
    sidebars, toolbars, and panels, and the open answer is defined by every
    ground being the same one. Its default is that second ground rather than
    panels, which spend an edge and an inset on every object and buy density
    back at the price of it.

    Cards and panels are out on the two surfaces whose content is the point.
    A page read at length is one column, and a page of work is the work.
  */
  'boundary-style': {
    tablist: 'Surface being separated',
    answered: 'separated by {}',
    unanswered: 'no boundary style chosen yet',
    surfaces: {
      persuade: { allow: 'open-space thin-dividers surface-changes cards-and-panels', fallback: 'open-space' },
      operate: { allow: 'thin-dividers surface-changes cards-and-panels', fallback: 'surface-changes' },
      read: { allow: 'open-space thin-dividers surface-changes', fallback: 'open-space' },
      experience: { allow: 'open-space thin-dividers surface-changes', fallback: 'open-space' },
    },
  },

  /*
    The least mode-sensitive question in the run, and the matrix says so. A
    radius is not a claim on the reader's attention the way a color or a shadow
    is, and the two surfaces that look like candidates both survive scrutiny:
    fully round controls are the house style of an entire mobile platform, so
    ruling them out of app UI would put this screen against Material rather
    than against a mistake, and a document has too few shapes for the answer to
    reach. Only the portfolio blocks anything, and its default is sharp, since
    a gallery hangs work square and the work's own edges are the shapes on the
    page.
  */
  'corner-style': {
    tablist: 'Surface being shaped',
    answered: '{} corners',
    unanswered: 'no corner style chosen yet',
    surfaces: {
      persuade: { allow: 'sharp slightly-soft friendly pill', fallback: 'slightly-soft' },
      operate: { allow: 'sharp slightly-soft friendly pill', fallback: 'slightly-soft' },
      read: { allow: 'sharp slightly-soft friendly pill', fallback: 'slightly-soft' },
      experience: { allow: 'sharp slightly-soft friendly', fallback: 'sharp' },
    },
  },

  /*
    Floating is out wherever the page is worked in or read at length, which is
    the line color strategy already drew for drenched. Lift that deep is how an
    overlay says it is temporary; spent on every resting panel it stops meaning
    anything and leaves a dense screen harder to scan. The portfolio keeps it:
    lifting the work off the page is a way of presenting the work.
  */
  'depth-style': {
    tablist: 'Surface being lifted',
    answered: '{} depth',
    unanswered: 'no depth style chosen yet',
    surfaces: {
      persuade: { allow: 'flat soft-lift floating', fallback: 'soft-lift' },
      operate: { allow: 'flat soft-lift', fallback: 'flat' },
      read: { allow: 'flat soft-lift', fallback: 'flat' },
      experience: { allow: 'flat soft-lift floating', fallback: 'flat' },
    },
  },
};

/* The matrix reaches the browser on the surface tiles, which is already where
   the script looks for everything a surface knows about itself. One pair of
   attributes per question, read by name rather than by dataset key so the
   question's own value is the lookup. A question this surface is not asked
   contributes nothing, and the absent per-surface field is what the script
   reads that from. */
export const surfaceAttrs = (mode) => Object.fromEntries(
  Object.entries(SURFACE_ANSWERS).flatMap(([name, question]) => {
    const { allow, fallback } = question.surfaces[mode] ?? {};
    return [
      ...(allow ? [[`data-allow-${name}`, allow]] : []),
      ...(fallback ? [[`data-default-${name}`, fallback]] : []),
    ];
  }),
);

/* Which surfaces a question is put to at all, in tile order. The per-surface
   fields a screen renders are the browser's copy of this, and the leading
   applicable surface is the one whose answer the bare key carries. */
export const surfacesAsked = (name) => SURFACE_MODES.filter(
  (mode) => mode in SURFACE_ANSWERS[name].surfaces,
);

/* Everything the script needs to run a per-surface question is on its tab
   strip, so a screen opts in by rendering one of these and nothing else. */
export const surfaceTabsAttrs = (name) => ({
  'data-surface-tabs': name,
  'data-surface-flat': SURFACE_ANSWERS[name].flat ? '' : undefined,
  'data-surface-proper-name': SURFACE_ANSWERS[name].properName ? '' : undefined,
  'data-surface-answered': SURFACE_ANSWERS[name].answered,
  'data-surface-unanswered': SURFACE_ANSWERS[name].unanswered,
  role: 'tablist',
  'aria-label': SURFACE_ANSWERS[name].tablist,
});
