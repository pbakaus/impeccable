import { serve, file } from "bun";
import path from "node:path";
import { fileURLToPath } from "node:url";
import homepage from "../public/index.html";
import privacy from "../public/privacy.html";
import {
  getSkills,
  getCommands,
  getCommandSource,
  getPatterns,
  handleFileDownload,
  handleBundleDownload
} from "./lib/api-handlers.js";
import { generateSubPages } from "../scripts/build-sub-pages.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// Pre-generate sub-pages so dev + prod share the same output shape.
console.log("📝 Generating sub-pages for dev server...");
const { files: subPageFiles } = await generateSubPages(ROOT_DIR);
console.log(`✓ Generated ${subPageFiles.length} sub-page(s)`);

// Helper: serve a generated HTML file by absolute path, 404 if missing.
async function serveGenerated(pagePath) {
  const f = file(pagePath);
  if (!(await f.exists())) return new Response("Not Found", { status: 404 });
  return new Response(f, {
    headers: {
      "Content-Type": "text/html;charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

const server = serve({
  port: process.env.PORT || 3000,

  routes: {
    "/": homepage,
    "/privacy": privacy,

    // Legacy URL redirects (kept stable for external links and existing users).
    "/cheatsheet": Response.redirect("/docs", 301),
    "/gallery": Response.redirect("/slop#try-it-live", 301),
    "/skills": Response.redirect("/docs", 301),
    "/skills/:id": (req) => Response.redirect(`/docs/${req.params.id}`, 301),
    "/anti-patterns": Response.redirect("/slop#catalog", 301),
    "/visual-mode": Response.redirect("/slop#see-it", 301),

    // Generated sub-pages — served directly from the pre-generated files
    "/docs": () => serveGenerated(path.join(ROOT_DIR, "public/docs/index.html")),
    "/docs/": () => serveGenerated(path.join(ROOT_DIR, "public/docs/index.html")),
    "/docs/:id": (req) => {
      const id = req.params.id.replace(/[^a-z0-9-]/gi, "");
      return serveGenerated(path.join(ROOT_DIR, `public/docs/${id}.html`));
    },
    "/slop": () => serveGenerated(path.join(ROOT_DIR, "public/slop/index.html")),
    "/slop/": () => serveGenerated(path.join(ROOT_DIR, "public/slop/index.html")),
    "/live-mode": () => serveGenerated(path.join(ROOT_DIR, "public/live-mode/index.html")),
    "/live-mode/": () => serveGenerated(path.join(ROOT_DIR, "public/live-mode/index.html")),
    "/designing": () => serveGenerated(path.join(ROOT_DIR, "public/designing/index.html")),
    "/designing/": () => serveGenerated(path.join(ROOT_DIR, "public/designing/index.html")),
    "/neo-mirai": () => Response.redirect("/neo-mirai/", 302),
    "/neo-mirai/": () => serveGenerated(path.join(ROOT_DIR, "public/neo-mirai/index.html")),
    "/neon-mirai": () => Response.redirect("/neo-mirai/", 301),
    "/neon-mirai/": () => Response.redirect("/neo-mirai/", 301),
    "/cases/neon-mirai": () => Response.redirect("/cases/neo-mirai", 301),
    "/cases/neon-mirai/": () => Response.redirect("/cases/neo-mirai", 301),
    "/cases/:slug": (req) => {
      const slug = req.params.slug.replace(/[^a-z0-9-]/gi, "");
      return serveGenerated(path.join(ROOT_DIR, `public/cases/${slug}/index.html`));
    },
    "/cases/:slug/": (req) => {
      const slug = req.params.slug.replace(/[^a-z0-9-]/gi, "");
      return serveGenerated(path.join(ROOT_DIR, `public/cases/${slug}/index.html`));
    },
    "/tutorials": () => serveGenerated(path.join(ROOT_DIR, "public/tutorials/index.html")),
    "/tutorials/": () => serveGenerated(path.join(ROOT_DIR, "public/tutorials/index.html")),
    "/tutorials/:slug": (req) => {
      const slug = req.params.slug.replace(/[^a-z0-9-]/gi, "");
      return serveGenerated(path.join(ROOT_DIR, `public/tutorials/${slug}.html`));
    },

    // Static assets - all public subdirectories
    "/assets/*": async (req) => {
      const url = new URL(req.url);
      if (url.pathname.includes('..')) return new Response("Bad Request", { status: 400 });
      const filePath = `./public${url.pathname}`;
      const assetFile = file(filePath);
      if (await assetFile.exists()) {
        return new Response(assetFile, {
          headers: { "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" }
        });
      }
      return new Response("Not Found", { status: 404 });
    },
    "/css/*": async (req) => {
      const url = new URL(req.url);
      if (url.pathname.includes('..')) return new Response("Bad Request", { status: 400 });
      const filePath = `./public${url.pathname}`;
      const assetFile = file(filePath);
      if (await assetFile.exists()) {
        return new Response(assetFile, {
          headers: { "Content-Type": "text/css", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" }
        });
      }
      return new Response("Not Found", { status: 404 });
    },
    "/js/*": async (req) => {
      const url = new URL(req.url);
      if (url.pathname.includes('..')) return new Response("Bad Request", { status: 400 });
      // Check public/js/ first, then fall back to built artifacts
      const headers = { "Content-Type": "application/javascript", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" };
      const publicFile = file(`./public${url.pathname}`);
      if (await publicFile.exists()) return new Response(publicFile, { headers });
      // Browser detector served from impeccable package
      if (url.pathname === '/js/detect-antipatterns-browser.js') {
        const pkgFile = file('./src/detect-antipatterns-browser.js');
        if (await pkgFile.exists()) return new Response(pkgFile, { headers });
      }
      return new Response("Not Found", { status: 404 });
    },
    // Test fixtures (for browser visual testing)
    "/fixtures/*": async (req) => {
      const url = new URL(req.url);
      if (url.pathname.includes('..')) return new Response("Bad Request", { status: 400 });
      const filePath = `./tests${url.pathname}`;
      const assetFile = file(filePath);
      if (await assetFile.exists()) {
        const ext = url.pathname.split('.').pop();
        const types = { html: 'text/html', css: 'text/css', js: 'application/javascript' };
        return new Response(assetFile, {
          headers: { "Content-Type": types[ext] || "application/octet-stream", "X-Content-Type-Options": "nosniff" }
        });
      }
      return new Response("Not Found", { status: 404 });
    },
    "/antipattern-images/*": async (req) => {
      const url = new URL(req.url);
      if (url.pathname.includes('..')) return new Response("Bad Request", { status: 400 });
      const filePath = `./public${url.pathname}`;
      const assetFile = file(filePath);
      if (await assetFile.exists()) {
        return new Response(assetFile, {
          headers: { "X-Content-Type-Options": "nosniff" }
        });
      }
      return new Response("Not Found", { status: 404 });
    },
    "/antipattern-examples/*": async (req) => {
      const url = new URL(req.url);
      if (url.pathname.includes('..')) return new Response("Bad Request", { status: 400 });
      const filePath = `./public${url.pathname}`;
      const assetFile = file(filePath);
      if (await assetFile.exists()) {
        return new Response(assetFile, {
          headers: { "Content-Type": "text/html", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN" }
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
      const result = await getCommandSource(id);
      if (result && result.error) {
        return Response.json({ error: result.error }, { status: result.status });
      }
      if (!result) {
        return Response.json({ error: "Command not found" }, { status: 404 });
      }
      return Response.json({ content: result });
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
    if (url.pathname.includes('..')) {
      return new Response("Bad Request", { status: 400 });
    }
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
