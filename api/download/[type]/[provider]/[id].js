import { handleFileDownload } from "../../../server/lib/api-handlers.js";

export default async function handler(request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // Extract params from path: /api/download/[type]/[provider]/[id]
  const type = pathParts[2]; // after 'api', 'download'
  const provider = pathParts[3];
  const id = pathParts[4];

  return handleFileDownload(type, provider, id);
}

