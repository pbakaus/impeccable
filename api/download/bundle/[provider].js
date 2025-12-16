import { handleBundleDownload } from "../../../server/lib/api-handlers.js";

export default async function handler(request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // Extract provider from path: /api/download/bundle/[provider]
  const provider = pathParts[3]; // after 'api', 'download', 'bundle'

  return handleBundleDownload(provider);
}

