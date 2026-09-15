/** Both panes use comp pixels and the same scale; source-image resolution is separate. */
export function comparisonSize(width: number, height: number, availableWidth: number, availableHeight: number, zoom: 'fit' | number) {
  const scale = zoom === 'fit' ? Math.min(availableWidth / width, availableHeight / height) : zoom;
  return { scale, width: width * scale, height: height * scale };
}

/** Map pointer position to the full scroll range, reaching both edges. */
export function hoverPan(position: number, start: number, viewport: number, content: number): number {
  if (viewport <= 0 || content <= viewport) return 0;
  const ratio = Math.max(0, Math.min(1, ((position - start) / viewport - .08) / .84));
  return ratio * (content - viewport);
}
