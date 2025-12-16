import { getPatterns } from "../server/lib/api-handlers.js";

export default async function handler(request) {
  const patterns = await getPatterns();
  return Response.json(patterns);
}
