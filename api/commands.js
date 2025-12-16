import { getCommands } from "../server/lib/api-handlers.js";

export default async function handler(request) {
  const commands = await getCommands();
  return Response.json(commands);
}

