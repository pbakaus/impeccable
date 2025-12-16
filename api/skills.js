import { getSkills } from "../server/lib/api-handlers.js";

export default async function handler(request) {
  const skills = await getSkills();
  return Response.json(skills);
}

