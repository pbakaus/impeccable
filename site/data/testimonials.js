// =====================================================================
// Testimonials data
//
// One source of truth for the homepage testimonials section. All marquee
// variants read from this list.
//
// Order is curated for impact: both marquee rows lead with the punchiest
// quotes (Ben Davis spotlight + the strongest punches) so the first
// viewport is loaded with the most memorable testimonials. The marquee
// component splits the array down the middle — first half drives row A,
// second half drives row B. Don't sort alphabetically; the order matters.
//
// Tweet text and avatar URLs were pulled from api.fxtwitter.com (a public
// JSON proxy for X.com). Quote text is verbatim except for: leading
// @-mention reply targets stripped, trailing self-links removed.
// Avatars live in site/public/assets/testimonials/<id>.jpg.
// =====================================================================

export const testimonials = [
  // ---- Row A: spotlight + heaviest hitters ----
  // Featured quote from a video on the Nerd Snipe Podcast.
  // No avatar (private @davis7 handle on Twitter); falls back to the coin.
  {
    id: 'davis7',
    handle: '@davis7',
    name: 'Ben Davis',
    role: 'co-host, Nerd Snipe Podcast',
    source: 'video',
    quote: "It fucking works beautifully. It's so cool.",
    tier: 'spotlight',
  },

  { id: 'MertcanDYuzer',   handle: '@MertcanDYuzer',   name: 'Mertcan Yüzer',
    avatar: '/assets/testimonials/MertcanDYuzer.jpg',
    url: 'https://x.com/MertcanDYuzer/status/2047058254878945560',
    quote: "Impeccable > Claude design" },

  { id: 'adrien_ninet',    handle: '@adrien_ninet',    name: 'Adrien Ninet',
    avatar: '/assets/testimonials/adrien_ninet.jpg',
    url: 'https://x.com/adrien_ninet/status/2041825321721458961',
    quote: "Uninstall whatever frontend skill you're using. Replace it with Impeccable." },

  { id: 'illscience',      handle: '@illscience',      name: 'Anish Acharya',
    avatar: '/assets/testimonials/illscience.jpg',
    url: 'https://x.com/illscience/status/2046953520449114555',
    quote: "Impeccable is the most slept on tool for incorporating design thinking into coding workflows." },

  { id: 'cathrynlavery-1', handle: '@cathrynlavery',   name: 'Cathryn Lavery',
    avatar: '/assets/testimonials/cathrynlavery-1.jpg',
    url: 'https://x.com/cathrynlavery/status/2055485368632295911',
    quote: "When anyone asks me about design for frontend I always recommend @impeccable_ai plugin. I'm very picky with design and it's become part of my everyday stack." },

  { id: 'IanAndrewsDC',    handle: '@IanAndrewsDC',    name: 'Ian Andrews',
    avatar: '/assets/testimonials/IanAndrewsDC.jpg',
    url: 'https://x.com/IanAndrewsDC/status/2029553242712002879',
    quote: "This is probably what Figma Make should be." },

  { id: 'carlrannaberg',   handle: '@carlrannaberg',   name: 'Carl Rannaberg',
    avatar: '/assets/testimonials/carlrannaberg.jpg',
    url: 'https://x.com/carlrannaberg/status/2053016778855305304',
    quote: "Impeccable is hands down the best UI design skill out there. I use it daily and recommend it to others as well. Great work! 💪" },

  { id: 'BowTiedGroundHo', handle: '@BowTiedGroundHo', name: 'BowTiedGroundHog',
    avatar: '/assets/testimonials/BowTiedGroundHo.jpg',
    url: 'https://x.com/BowTiedGroundHo/status/2055062377541091373',
    quote: "It has taken my ability to ship complex and beautiful designs to another level." },

  { id: 'ivanleomk',       handle: '@ivanleomk',       name: 'Ivan Leo',
    avatar: '/assets/testimonials/ivanleomk.jpg',
    url: 'https://x.com/ivanleomk/status/2041371674248147047',
    quote: "Impeccable is the best skill I've used this year. Can't believe it's free." },

  { id: 'wanikwai',        handle: '@wanikwai',        name: 'Watson Cyrus Anikwai',
    avatar: '/assets/testimonials/wanikwai.jpg',
    url: 'https://x.com/wanikwai/status/2044973876963311928',
    quote: "Impeccable is so so good. I love it." },

  { id: 'faizan10114-2',   handle: '@faizan10114',     name: 'Faizan Khan',
    avatar: '/assets/testimonials/faizan10114.jpg',
    url: 'https://x.com/faizan10114/status/2052872900324057321',
    quote: "I will fight anyone who say anything bad against impeccable, just let me know who they are." },

  { id: 'Hicker_Moledao',  handle: '@Hicker_Moledao',  name: 'Hickerzed',
    avatar: '/assets/testimonials/Hicker_Moledao.jpg',
    url: 'https://x.com/Hicker_Moledao/status/2057451530459160942',
    quote: "I've tried and used many UI design tools that enhance AI aesthetics, and this one is the best and most stunning I've ever used." },

  { id: 'largePrawn',      handle: '@largePrawn',      name: 'Tony Ge',
    avatar: '/assets/testimonials/largePrawn.jpg',
    url: 'https://x.com/largePrawn/status/2054644203330961471',
    quote: "Jorks ur shit crazy style" },

  { id: 'karatzas_thomas', handle: '@karatzas_thomas', name: 'Thomas Karatzas',
    avatar: '/assets/testimonials/karatzas_thomas.jpg',
    url: 'https://x.com/karatzas_thomas/status/2052753026864042368',
    quote: "@impeccable_ai is really good and is the first time I really felt a 10x productivity boost with AI. And I make an effort to try as many tools as possible." },

  { id: 'faizan10114',     handle: '@faizan10114',     name: 'Faizan Khan',
    avatar: '/assets/testimonials/faizan10114.jpg',
    url: 'https://x.com/faizan10114/status/2052620908615917922',
    quote: "TIL you are the guy behind Impeccable. I owe like 3 customer conversions to you. Thank you for such an amazing tool." },

  { id: 'MikitaHQ',        handle: '@MikitaHQ',        name: 'Mikita',
    avatar: '/assets/testimonials/MikitaHQ.jpg',
    url: 'https://x.com/MikitaHQ/status/2043352324047774008',
    quote: "Shipped a landing page in 2 hours using @conductor_build & @impeccable_ai. From idea to prod faster than most people pick a font ;))" },

  // ---- Row B: second-tier punches + substance ----

  { id: 'vandotorres',     handle: '@vandotorres',     name: 'Servando',
    avatar: '/assets/testimonials/vandotorres.jpg',
    url: 'https://x.com/vandotorres/status/2042263432448090256',
    quote: "THIS. This shit works." },

  { id: 'eclecticV',       handle: '@eclecticV',       name: 'Vishveshwar Jatain',
    avatar: '/assets/testimonials/eclecticV.jpg',
    url: 'https://x.com/eclecticV/status/2042086081827623331',
    quote: "This is the best plugin ever created imo." },

  { id: 'nik_ska',         handle: '@nik_ska',         name: 'Nik',
    avatar: '/assets/testimonials/nik_ska.jpg',
    url: 'https://x.com/nik_ska/status/2037158216488919184',
    quote: "Claude skills are mostly BS. These ones are the rare, truly useful ones." },

  { id: 'HeyZohaib',       handle: '@HeyZohaib',       name: 'Zohaib A.',
    avatar: '/assets/testimonials/HeyZohaib.jpg',
    url: 'https://x.com/HeyZohaib/status/2047568264273023058',
    quote: "How is this free?? 🔥🔥" },

  { id: 'IceCreamChai',    handle: '@IceCreamChai',    name: 'Sankalp Mukim',
    avatar: '/assets/testimonials/IceCreamChai.jpg',
    url: 'https://x.com/IceCreamChai/status/2056718266593341867',
    quote: "It's crazy that @impeccable_ai is free. It replaces some paid products while being better than them." },

  { id: 'michaelhedgpeth', handle: '@michaelhedgpeth', name: 'Michael Hedgpeth',
    avatar: '/assets/testimonials/michaelhedgpeth.jpg',
    url: 'https://x.com/michaelhedgpeth/status/2045283339264028817',
    quote: "@impeccable_ai has been a huge help at all levels from prototyping to production. It has really upped our game. I can't see anything out-of-the-box like this replacing it." },

  { id: 'littlemartta',    handle: '@littlemartta',    name: 'martta_xu',
    avatar: '/assets/testimonials/littlemartta.jpg',
    url: 'https://x.com/littlemartta/status/2039038639087194470',
    quote: "Impeccable is the best frontend design skill I've used rn. It clears the alternatives by a mile." },

  { id: 'Paul_Kinlan',     handle: '@Paul_Kinlan',     name: 'Paul Kinlan',
    avatar: '/assets/testimonials/Paul_Kinlan.jpg',
    url: 'https://x.com/Paul_Kinlan/status/2047580124141310457',
    quote: "This is incredible. Developer and Designer workflows are changing so quickly and for the better." },

  { id: 'JASHANGUPTA15',   handle: '@JASHANGUPTA15',   name: 'Jashan Gupta',
    avatar: '/assets/testimonials/JASHANGUPTA15.jpg',
    url: 'https://x.com/JASHANGUPTA15/status/2057568922443133188',
    quote: "Recently used this skill for my personal portfolio and was blown away. Iterated multiple times on Claude code and hardly touched Figma." },

  { id: 'sid_hori',        handle: '@sid_hori',        name: 'Sidney Hori Hawthorne',
    avatar: '/assets/testimonials/sid_hori.jpg',
    url: 'https://x.com/sid_hori/status/2030486593048326567',
    quote: "This is 🔥. My landing page looked 100% vibe coded. I think it looks very decent now. I had fun in the process." },

  { id: 'billzh',          handle: '@billzh',          name: 'billzh',
    avatar: '/assets/testimonials/billzh.jpg',
    url: 'https://x.com/billzh/status/2035525691085603172',
    quote: "I'm glad that we never need to touch Figma again. Just run 8 agents using @paper w/ Impeccable's Claude skills." },

  { id: 'johnennis',       handle: '@johnennis',       name: 'John Ennis',
    avatar: '/assets/testimonials/johnennis.jpg',
    url: 'https://x.com/johnennis/status/2038248854726791481',
    quote: "Impeccable is such a great skill. I use it multiple times a day every day and it makes a huge difference." },

  { id: 'devsome_sh',      handle: '@devsome_sh',      name: 'Somesh',
    avatar: '/assets/testimonials/devsome_sh.jpg',
    url: 'https://x.com/devsome_sh/status/2049193038447264007',
    quote: "Upgraded an internal tool with better UI, UX, branding and reduced AI slop. This established a standard for the project itself." },

  { id: 'alejandroreyes',  handle: '@alejandroreyes',  name: 'Alejandro Reyes',
    avatar: '/assets/testimonials/alejandroreyes.jpg',
    url: 'https://x.com/alejandroreyes/status/2055495489777434973',
    quote: "It's so good." },

  { id: 'EmreCoklar',      handle: '@EmreCoklar',      name: 'Emre Coklar',
    avatar: '/assets/testimonials/EmreCoklar.jpg',
    url: 'https://x.com/EmreCoklar/status/2036873830191251677',
    quote: "This is the only set of agent skills I ever found use in. Thanks for making this." },
];

// Helpers used by the marquee variants
export const spotlight = testimonials.find(t => t.tier === 'spotlight');
