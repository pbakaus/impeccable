import { serve, file } from "bun";
import homepage from "../public/index.html";
import cheatsheet from "../public/cheatsheet.html";
import {
  getSkills,
  getCommands,
  getCommandSource,
  getPatterns,
  handleFileDownload,
  handleBundleDownload
} from "./lib/api-handlers.js";

const server = serve({
  port: process.env.PORT || 3000,

  routes: {
    "/": homepage,
    "/cheatsheet": cheatsheet,

    // Static assets - all public subdirectories
    "/assets/*": async (req) => {
      const url = new URL(req.url);
      const filePath = `./public${url.pathname}`;
      const assetFile = file(filePath);
      if (await assetFile.exists()) {
        return new Response(assetFile);
      }
      return new Response("Not Found", { status: 404 });
    },
    "/css/*": async (req) => {
      const url = new URL(req.url);
      const filePath = `./public${url.pathname}`;
      const assetFile = file(filePath);
      if (await assetFile.exists()) {
        return new Response(assetFile, {
          headers: { "Content-Type": "text/css" }
        });
      }
      return new Response("Not Found", { status: 404 });
    },
    "/js/*": async (req) => {
      const url = new URL(req.url);
      const filePath = `./public${url.pathname}`;
      const assetFile = file(filePath);
      if (await assetFile.exists()) {
        return new Response(assetFile, {
          headers: { "Content-Type": "application/javascript" }
        });
      }
      return new Response("Not Found", { status: 404 });
    },
    "/antipattern-examples/*": async (req) => {
      const url = new URL(req.url);
      const filePath = `./public${url.pathname}`;
      const assetFile = file(filePath);
      if (await assetFile.exists()) {
        return new Response(assetFile, {
          headers: { "Content-Type": "text/html" }
        });
      }
      return new Response("Not Found", { status: 404 });
    },

    // API: Get all skills
    "/api/skills": {
      async GET() {
        const skills = await getSkills();
        return Response.json(skills);
      },
    },
    
    // API: Get all commands
    "/api/commands": {
      async GET() {
        const commands = await getCommands();
        return Response.json(commands);
      },
    },

    // API: Get patterns and antipatterns
    "/api/patterns": {
      async GET() {
        const patterns = await getPatterns();
        return Response.json(patterns);
      },
    },

    // API: Get command source content
    "/api/command-source/:id": async (req) => {
      const { id } = req.params;
      const content = await getCommandSource(id);
      if (!content) {
        return Response.json({ error: "Command not found" }, { status: 404 });
      }
      return Response.json({ content });
    },

    // API: Download individual file
    "/api/download/:type/:provider/:id": async (req) => {
      const { type, provider, id } = req.params;
      return handleFileDownload(type, provider, id);
    },
    
    // API: Download provider bundle ZIP
    "/api/download/bundle/:provider": async (req) => {
      const { provider } = req.params;
      return handleBundleDownload(provider);
    },
  },
  
  // Serve root-level static files (og-image.png, favicon, robots.txt, etc.)
  fetch(req) {
    const url = new URL(req.url);
    const filePath = `./public${url.pathname}`;
    const staticFile = file(filePath);
    if (staticFile.size > 0) {
      return new Response(staticFile);
    }
    return new Response("Not Found", { status: 404 });
  },

  development: process.env.NODE_ENV !== "production",
});

console.log(`🎨 impeccable.style running at ${server.url}`);

