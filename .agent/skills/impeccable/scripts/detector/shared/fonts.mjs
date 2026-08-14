const GOOGLE_FONTS_URL_RE = /fonts\.googleapis\.com\/css2?\?[^"'\s)<>]*/gi;

function normalizeGoogleFontFamilyParam(value) {
  return String(value || '')
    .split('|')
    .map(part => part.split(':')[0].trim().toLowerCase())
    .filter(Boolean);
}

function extractGoogleFontFamilies(text) {
  const families = [];
  if (!text) return families;

  GOOGLE_FONTS_URL_RE.lastIndex = 0;
  let urlMatch;
  while ((urlMatch = GOOGLE_FONTS_URL_RE.exec(text)) !== null) {
    const url = urlMatch[0];
    const queryStart = url.indexOf('?');
    if (queryStart === -1) continue;

    const params = new URLSearchParams(url.slice(queryStart + 1).replace(/&amp;/g, '&'));
    for (const value of params.getAll('family')) {
      families.push(...normalizeGoogleFontFamilyParam(value));
    }
  }

  return families;
}

export { extractGoogleFontFamilies };
