export const QUESTIONNAIRE_VERSION = 1;

export const COMMANDS = new Set(['shape', 'craft']);

export const COLOR_STRATEGIES = [
  { value: 'restrained', label: 'Restrained', hint: 'Tinted neutrals plus one accent used sparingly.' },
  { value: 'committed', label: 'Committed', hint: 'One saturated color carries a meaningful share of the surface.' },
  { value: 'full-palette', label: 'Full palette', hint: 'Three or four named roles used deliberately.' },
  { value: 'drenched', label: 'Drenched', hint: 'The surface itself is the color.' },
];

export const QUESTIONNAIRE_SLIDES = [
  {
    id: 'project-identity',
    kind: 'text',
    title: 'What are we making?',
    prompt: 'Describe the site in one plain sentence.',
    placeholder: 'A site for an independent hotel, a design studio, a local restaurant, or a new product launch.',
    designKey: 'siteOverview',
    required: true,
  },
  {
    id: 'purpose',
    kind: 'text',
    title: 'What should we call it?',
    prompt: 'Use the public name people will see on the site. A working name is fine.',
    placeholder: 'The Maritime House',
    suggestions: ['Use the working name', 'Name not final yet'],
    designKey: 'projectIdentity',
    required: true,
  },
  {
    id: 'primary-user',
    kind: 'text',
    title: 'Who is it for?',
    prompt: 'Name the main person visiting and what they came to do.',
    placeholder: 'Travelers comparing quiet coastal hotels for a long weekend.',
    suggestions: [
      { label: 'First-time visitor', value: 'A first-time visitor trying to decide whether this feels trustworthy.' },
      { label: 'Private comparison', value: 'A buyer comparing options quietly on mobile.' },
      { label: 'Needs reassurance', value: 'Someone who wants reassurance before taking the next step.' },
    ],
    designKey: 'primaryUser',
    required: true,
  },
  {
    id: 'success',
    kind: 'text',
    title: 'What should the first screen make clear?',
    prompt: 'Say what a visitor should understand before they scroll.',
    placeholder: 'This is a calm, premium hotel with direct booking and real local character.',
    suggestions: [
      { label: 'Credible', value: 'This is credible, specific, and worth exploring further.' },
      { label: 'Safe next step', value: 'The offer is clear and the next step feels safe.' },
      { label: 'Understood', value: 'This brand understands the visitor before asking for action.' },
    ],
    designKey: 'success',
    required: true,
  },
  {
    id: 'content-data',
    kind: 'text',
    title: 'What real material exists?',
    prompt: 'List offers, pages, proof, photography, products, services, facts, or constraints the site can show.',
    placeholder: 'Three services, five project photos, two testimonials, a short founder story, and a contact form.',
    suggestions: [
      { label: 'Product proof', value: 'Product details, proof points, FAQs, delivery information, and contact path.' },
      { label: 'Service proof', value: 'Photography, service pages, testimonials, founder story, and pricing cues.' },
      { label: 'Launch proof', value: 'Launch copy, product specs, social proof, and a clear support route.' },
    ],
    designKey: 'contentData',
    required: true,
  },
  {
    id: 'key-states',
    kind: 'multi',
    title: 'Which moments need care?',
    prompt: 'Select the site states and moments that should be designed deliberately.',
    designKey: 'keyStates',
    required: true,
    options: [
      { value: 'default', label: 'First impression' },
      { value: 'empty', label: 'Coming soon or sparse content' },
      { value: 'loading', label: 'Loading media' },
      { value: 'error', label: 'Form error' },
      { value: 'success', label: 'Form success' },
      { value: 'long-content', label: 'Long story or case study' },
      { value: 'mobile', label: 'Mobile visit' },
    ],
  },
  {
    id: 'color-strategy',
    kind: 'choice',
    title: 'How much should color carry?',
    prompt: 'Pick the color commitment for the site.',
    designKey: 'colorStrategy',
    required: true,
    options: COLOR_STRATEGIES,
  },
  {
    id: 'theme-scene',
    kind: 'text',
    title: 'Where does it live?',
    prompt: 'Write the physical scene: who is there, what light is present, and what mood the brand holds.',
    placeholder: 'A hotel owner at a walnut desk before sunrise, checking inquiries in a quiet lobby.',
    suggestions: [
      { label: 'Private evening', value: 'A quiet evening mobile search, low light, private and deliberate.' },
      { label: 'Morning clarity', value: 'A bright morning desk, calm comparison, practical confidence.' },
      { label: 'Local counter', value: 'A small shop counter, direct conversation, warm proof.' },
    ],
    designKey: 'themeScene',
    required: true,
  },
  {
    id: 'visual-north-star',
    kind: 'text',
    title: 'What should it feel near?',
    prompt: 'Name two or three concrete references: places, objects, publications, products, or brands.',
    placeholder: 'A restored guesthouse key tag, Apartamento magazine, and the booking desk at a quiet inn.',
    suggestions: [
      { label: 'Product label', value: 'A precise product label, a calm editorial spread, and a private consultation room.' },
      { label: 'Care retail', value: 'A pharmacy shelf with taste, a warm clinical note, and a modern care brand.' },
      { label: 'Mobile checkout', value: 'A trusted local counter, a soft package insert, and a direct mobile checkout.' },
    ],
    designKey: 'visualNorthStar',
    required: true,
  },
  {
    id: 'typography-voice',
    kind: 'text',
    title: 'What is the type voice?',
    prompt: 'Describe the typography as a physical object, not as adjectives.',
    placeholder: 'A printed room directory with generous margins, crisp captions, and confident names.',
    suggestions: [
      { label: 'Care leaflet', value: 'A clear care leaflet with warm headings and exact detail.' },
      { label: 'Product label', value: 'A premium product label with quiet confidence.' },
      { label: 'Mobile checkout', value: 'A calm mobile checkout with readable guidance.' },
    ],
    designKey: 'typographyVoice',
    required: true,
  },
  {
    id: 'component-feel',
    kind: 'choice',
    title: 'How should the interface feel?',
    prompt: 'Choose the closest material and interaction posture.',
    designKey: 'componentFeel',
    required: true,
    options: [
      { value: 'quiet-precise', label: 'Quiet and precise', hint: 'Flat surfaces, clear rules, no decorative noise.' },
      { value: 'tactile-confident', label: 'Tactile and confident', hint: 'Obvious calls to action, crisp focus, restrained lift.' },
      { value: 'editorial-light', label: 'Editorial and light', hint: 'Text-led rhythm, generous whitespace, minimal chrome.' },
      { value: 'dense-operator', label: 'Compact and direct', hint: 'Short paths, practical controls, built for return visits.' },
    ],
  },
  {
    id: 'motion-access',
    kind: 'text',
    title: 'What constraints matter?',
    prompt: 'List motion, accessibility, responsive, localization, CMS, asset, or launch constraints.',
    placeholder: 'WCAG AA, mobile first, reduced motion, client-editable copy, and no heavy homepage video.',
    suggestions: [
      { label: 'Accessible', value: 'WCAG AA, mobile first, reduced motion, bilingual-ready copy.' },
      { label: 'Fast + bilingual', value: 'Fast load, accessible forms, readable Arabic/English text, no heavy video.' },
      { label: 'CMS + support', value: 'CMS-editable content, private support paths, clear error states.' },
    ],
    designKey: 'motionAccess',
    required: false,
  },
  {
    id: 'do-dont',
    kind: 'text',
    title: 'What would feel wrong?',
    prompt: 'Give concrete anti-goals, brand cliches, visual traps, or trust breakers to avoid.',
    placeholder: 'No luxury beige default, no fake awards, no generic startup gradients, no stock smiles.',
    suggestions: [
      { label: 'No beige wellness', value: 'No generic wellness beige, no fake medical authority, no shame-based copy.' },
      { label: 'No period tropes', value: 'No childish period tropes, no sterile hospital coldness, no stock smiles.' },
      { label: 'No vague slogans', value: 'No vague empowerment slogans without practical trust.' },
    ],
    designKey: 'doDont',
    required: true,
  },
];

export function getSlide(slideId) {
  return QUESTIONNAIRE_SLIDES.find((slide) => slide.id === slideId) || null;
}

export function getNextSlideId(slideId) {
  const index = QUESTIONNAIRE_SLIDES.findIndex((slide) => slide.id === slideId);
  if (index < 0 || index >= QUESTIONNAIRE_SLIDES.length - 1) return null;
  return QUESTIONNAIRE_SLIDES[index + 1].id;
}

export function validateCommand(command) {
  if (!COMMANDS.has(command)) {
    throw new Error(`command must be one of: ${Array.from(COMMANDS).join(', ')}`);
  }
  return command;
}

export function normalizeAnswer(slideId, input) {
  const slide = getSlide(slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  const raw = input && typeof input === 'object' ? input : { value: input };

  if (slide.kind === 'multi') {
    const values = Array.isArray(raw.value)
      ? raw.value.map((value) => String(value).trim()).filter(Boolean)
      : String(raw.value || '').split(',').map((value) => value.trim()).filter(Boolean);
    const allowed = new Set((slide.options || []).map((option) => option.value));
    const unique = [...new Set(values)].filter((value) => allowed.has(value));
    if (slide.required && unique.length === 0) throw new Error(`${slideId} requires at least one option.`);
    return {
      value: unique,
      label: unique.map((value) => slide.options.find((option) => option.value === value)?.label || value).join(', '),
      freeform: normalizeFreeform(raw.freeform),
    };
  }

  if (slide.kind === 'choice') {
    const value = String(raw.value || '').trim();
    const option = (slide.options || []).find((candidate) => candidate.value === value);
    if (!option) throw new Error(`${slideId} must be one of: ${slide.options.map((item) => item.value).join(', ')}`);
    return {
      value,
      label: option.label,
      freeform: normalizeFreeform(raw.freeform),
    };
  }

  const value = normalizeText(raw.value);
  if (slide.required && !value) throw new Error(`${slideId} requires an answer.`);
  return {
    value,
    label: value,
    freeform: normalizeFreeform(raw.freeform),
  };
}

export function answersByDesignKey(answers = {}) {
  const out = {};
  for (const slide of QUESTIONNAIRE_SLIDES) {
    const answer = answers[slide.id];
    if (!answer) continue;
    out[slide.designKey] = answer;
  }
  return out;
}

export function validateCompleteAnswers(answers = {}) {
  const missing = [];
  for (const slide of QUESTIONNAIRE_SLIDES) {
    if (!slide.required) continue;
    try {
      normalizeAnswer(slide.id, answers[slide.id]);
    } catch {
      missing.push(slide.id);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required answers: ${missing.join(', ')}`);
  }
  return true;
}

export function createAdaptiveSlidePatches(answers = {}) {
  const siteOverview = normalizeText(answers['project-identity']?.value);
  const brand = inferBrandName(answers.purpose?.value);
  const patches = {};

  if (siteOverview && !brand) {
    const candidateName = inferBrandName(siteOverview);
    patches.purpose = normalizeSlidePatch('purpose', {
      title: candidateName ? `Is ${candidateName} the public name?` : 'What should we call it?',
      prompt: candidateName
        ? `I picked up ${candidateName} from your site description. Confirm the exact public name people should see, or type the right one.`
        : 'Give this site a public name. A working name is fine.',
      placeholder: candidateName || namePlaceholderForSite(siteOverview),
      suggestions: nameSuggestionsForSite(siteOverview, candidateName),
    });
  }

  if (brand) {
    patches['primary-user'] = normalizeSlidePatch('primary-user', {
      title: `Who is ${brand} for?`,
      prompt: `Describe the person arriving at ${brand}'s site: what they are trying to understand, compare, feel, or trust.`,
      placeholder: `A ${brand} visitor is weighing whether this brand understands their world before reaching out.`,
      suggestions: userSuggestionsForSite(siteOverview, brand),
    });
    patches.success = normalizeSlidePatch('success', {
      title: `What should ${brand}'s first screen make clear?`,
      prompt: `Say what a visitor should understand about ${brand} before they scroll.`,
      placeholder: `${brand} is specific, trustworthy, and worth exploring further.`,
      suggestions: successSuggestionsForSite(siteOverview, brand),
    });
  }

  if (brand && siteOverview) {
    patches['content-data'] = normalizeSlidePatch('content-data', {
      title: `What can prove ${brand}'s promise?`,
      prompt: `List the real pages, offers, proof, images, services, numbers, and stories that can support: "${truncateForPrompt(siteOverview)}"`,
      placeholder: 'Services, project examples, founder story, testimonials, process notes, pricing cues, and a clear contact path.',
      suggestions: contentSuggestionsForSite(siteOverview),
    });
    patches['visual-north-star'] = normalizeSlidePatch('visual-north-star', {
      title: `What should ${brand} feel near?`,
      prompt: `Name references that make "${truncateForPrompt(siteOverview)}" feel specific: places, objects, publications, products, or brands.`,
      placeholder: 'A neighborhood hotel key tag, a sharp editorial contents page, and a quiet hospitality counter.',
      suggestions: referenceSuggestionsForSite(siteOverview),
    });
  }

  return patches;
}

export function normalizeSlidePatch(slideId, patch = {}) {
  const slide = getSlide(slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  const out = {};
  for (const key of ['title', 'prompt']) {
    const value = normalizeText(patch[key]);
    if (value) out[key] = value;
  }
  if (slide.kind === 'text') {
    const placeholder = normalizeText(patch.placeholder);
    if (placeholder) out.placeholder = placeholder;
    const suggestions = normalizeSuggestions(patch.suggestions);
    if (suggestions.length > 0) out.suggestions = suggestions;
  }
  return out;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeFreeform(value) {
  const text = normalizeText(value);
  return text || undefined;
}

function normalizeSuggestions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const label = normalizeText(typeof item === 'object' && item ? item.label : item);
    const answer = normalizeText(typeof item === 'object' && item ? (item.value || item.answer || item.label) : item);
    if (!label || !answer || seen.has(`${label}\n${answer}`)) continue;
    seen.add(`${label}\n${answer}`);
    out.push({ label, value: answer });
    if (out.length >= 4) break;
  }
  return out;
}

function inferBrandName(value) {
  const text = normalizeText(value);
  if (!text) return '';
  if (/^(?:a|an|the)?\s*(?:site|website|landing page|page)\s+for\b/i.test(text)) return '';
  const beforeVerb = text.match(/^(.+?)\s+(?:is|are|helps|makes|creates|builds|offers|provides)\b/i)?.[1];
  const candidate = beforeVerb || text.split(/[.,:;!?]/)[0];
  const words = normalizeText(candidate).split(' ').slice(0, 5).join(' ');
  return words.replace(/^the\s+/i, '').replace(/[^\p{L}\p{N}&'. -]/gu, '').trim();
}

function nameSuggestionsForSite(value, candidateName) {
  const text = normalizeText(value).toLowerCase();
  if (candidateName) {
    if (isFemcareSite(text)) {
      return [
        { label: candidateName, value: candidateName },
        { label: `${candidateName} Care`, value: `${candidateName} Care` },
        { label: `${candidateName} Wellness`, value: `${candidateName} Wellness` },
      ];
    }
    return [{ label: candidateName, value: candidateName }];
  }
  if (isFemcareSite(text)) return ['Rahaty', 'Noura Care', 'Luna Care'];
  if (/\b(hotel|inn|guesthouse|guest house|stay|resort|lodging)\b/.test(text)) return ['The Maritime House', 'Harbor House', 'North Pier'];
  if (/\b(restaurant|cafe|bar|bakery|kitchen|dining)\b/.test(text)) return ['Table & Harbor', 'Common Table', 'Saffron Room'];
  if (/\b(studio|agency|practice|portfolio|creative)\b/.test(text)) return ['Fieldwork Studio', 'North Pier Studio', 'Studio Atlas'];
  if (/\b(product|app|tool|software|platform|dashboard)\b/.test(text)) return ['Orbit Ledger', 'Field Notes', 'Signal Desk'];
  return ['Aster House', 'Common Ground', 'North Star'];
}

function userSuggestionsForSite(value, brand) {
  const text = normalizeText(value).toLowerCase();
  if (isFemcareSite(text)) {
    return [
      { label: 'GCC woman', value: `A woman in the GCC looking for discreet, trustworthy period care from ${brand}.` },
      { label: 'Private mobile search', value: 'A young adult comparing femcare products privately on mobile.' },
      { label: 'Caregiver check', value: 'A mother or caregiver checking whether the brand feels safe and credible.' },
    ];
  }
  return [
    { label: 'First-time visitor', value: `A first-time ${brand} visitor deciding whether this feels trustworthy.` },
    { label: 'Mobile comparison', value: 'A mobile visitor comparing options before taking the next step.' },
    { label: 'Needs proof', value: 'Someone who needs clarity, proof, and a low-pressure path forward.' },
  ];
}

function successSuggestionsForSite(value, brand) {
  const text = normalizeText(value).toLowerCase();
  if (isFemcareSite(text)) {
    return [
      { label: 'Discreet care', value: `${brand} is discreet, modern, and trustworthy for period care in the region.` },
      { label: 'Private purchase', value: 'The products are easy to understand, private to buy, and safe to trust.' },
      { label: 'No embarrassment', value: 'This brand treats femcare with confidence, not embarrassment.' },
    ];
  }
  return [
    { label: 'Credible', value: `${brand} is specific, credible, and worth exploring further.` },
    { label: 'Safe next step', value: 'The offer is clear, the proof is real, and the next step feels safe.' },
    { label: 'Understood', value: 'This site understands the visitor before asking for action.' },
  ];
}

function contentSuggestionsForSite(value) {
  const text = normalizeText(value).toLowerCase();
  if (isFemcareSite(text)) {
    return [
      { label: 'Product trust', value: 'Product range, materials, usage guidance, privacy-safe FAQs, delivery details, and trust proof.' },
      { label: 'Care education', value: 'Care education, product comparison, ingredients or materials, reviews, and discreet checkout.' },
      { label: 'Safety notes', value: 'Brand story, clinical or safety notes, shipping privacy, support path, and common concerns.' },
    ];
  }
  return [
    { label: 'Offer proof', value: 'Offers, proof points, photography, testimonials, FAQ, and a clear contact path.' },
    { label: 'Service proof', value: 'Product details, service pages, founder story, pricing cues, and support routes.' },
    { label: 'Launch proof', value: 'Launch copy, real examples, constraints, social proof, and conversion path.' },
  ];
}

function referenceSuggestionsForSite(value) {
  const text = normalizeText(value).toLowerCase();
  if (isFemcareSite(text)) {
    return [
      { label: 'Warm pharmacy', value: 'A warm pharmacy shelf, a calm care leaflet, and a discreet premium package.' },
      { label: 'Regional beauty retail', value: 'Modern Middle Eastern beauty retail, soft clinical notes, and private mobile checkout.' },
      { label: 'Support chat', value: 'A trusted local counter, a clean product label, and a gentle support chat.' },
    ];
  }
  return [
    { label: 'Product label', value: 'A precise product label, a calm editorial spread, and a private consultation room.' },
    { label: 'Quiet checkout', value: 'A trusted local counter, a sharp contents page, and a quiet checkout.' },
    { label: 'Package insert', value: 'A tactile package insert, a focused mobile flow, and a confident service desk.' },
  ];
}

function isFemcareSite(text) {
  return /\b(femcare|period|menstrual|menstruation|women'?s health|pads?|tampons?|cycle|pms)\b/.test(text);
}

function namePlaceholderForSite(value) {
  const text = normalizeText(value).toLowerCase();
  if (isFemcareSite(text)) return 'Rahaty';
  if (/\b(hotel|inn|guesthouse|guest house|stay|resort|lodging)\b/.test(text)) return 'The Maritime House';
  if (/\b(restaurant|cafe|bar|bakery|kitchen|dining)\b/.test(text)) return 'Table & Harbor';
  if (/\b(studio|agency|practice|portfolio|creative)\b/.test(text)) return 'Fieldwork Studio';
  if (/\b(product|app|tool|software|platform|dashboard)\b/.test(text)) return 'Orbit Ledger';
  return 'Aster House';
}

function truncateForPrompt(value) {
  const text = normalizeText(value);
  if (text.length <= 110) return text;
  return `${text.slice(0, 107).trim()}...`;
}
