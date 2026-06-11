import { getDefaultRules } from '../../cli/engine/registry/antipatterns.mjs';

export function getExtensionAntipatternsMetadata() {
  // Include description so the devtools panel can show the full rule explanation
  // in tooltips.
  return getDefaultRules().map(({ id, name, category, description }) => ({
    id,
    name,
    category: category || 'quality',
    description: description || '',
  }));
}
