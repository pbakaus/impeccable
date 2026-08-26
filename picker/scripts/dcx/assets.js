/* Session-aware URLs for the document's own images (section foils, rail
   textures, placeholder brand assets, the components photo).

   The submit-flow picker server exits the moment /submit resolves, and article
   images only load when a view opens, which is always after that exit. The doc
   session lives on, so once design-context.js announces one on
   window.dcxDocSession, every document asset routes through it (the session's
   /assets route arrives with that announcement). Until then paths pass through
   untouched and the page's own origin serves them — which is the whole story in
   document mode, where the picker server stays up. */
export const dcxAsset = (assetPath) => {
  const session = window.dcxDocSession;
  if (!session?.base || !session?.token) return assetPath;
  return `${session.base}${assetPath}?token=${encodeURIComponent(session.token)}`;
};
