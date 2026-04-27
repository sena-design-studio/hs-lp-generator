import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const indexPath = path.join(__dirname, '..', 'index.js');
let idx = fs.readFileSync(indexPath, 'utf8');

// Strip everything from the START marker onwards
const marker = '// ─── START ────────────────────────────────────────────────────────────────────';
const markerPos = idx.indexOf(marker);
if (markerPos === -1) { console.log('✗ Marker not found'); process.exit(1); }

// Also strip any existing new tools that may have been added before the marker
let base = idx.slice(0, markerPos);

// Remove any previously patched tool blocks
base = base.replace(/\/\/ ─── TOOL: get_page[\s\S]*?(?=\/\/ ─── TOOL:|\/\/ ─── START|$)/g, '');
base = base.replace(/\/\/ ─── TOOL: update_page_content[\s\S]*?(?=\/\/ ─── TOOL:|\/\/ ─── START|$)/g, '');
base = base.replace(/\/\/ ─── TOOL: web_search[\s\S]*?(?=\/\/ ─── TOOL:|\/\/ ─── START|$)/g, '');

const newTail = `
// ─── TOOL: get_page ───────────────────────────────────────────────────────────
server.tool(
  "get_page",
  "Get the current content and module field values of an existing HubSpot landing page",
  {
    portal_id: z.string().describe("HubSpot portal ID"),
    page_id: z.string().describe("HubSpot page ID"),
  },
  async ({ portal_id, page_id }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const res = await fetch(
        \`https://api.hubapi.com/cms/v3/pages/landing-pages/\${page_id}?archived=false\`,
        { headers: { Authorization: \`Bearer \${token}\` } }
      );
      if (!res.ok) throw new Error(\`HubSpot API error: \${res.status} \${await res.text()}\`);
      const page = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify({
          status: "ok",
          page: {
            id: page.id,
            name: page.name,
            slug: page.slug,
            state: page.state,
            template: page.templatePath,
            updated: page.updatedAt,
            draft_url: \`https://app.hubspot.com/pages/\${portal_id}/editor/\${page.id}\`,
            widgets: page.layoutSections ?? {},
            meta_title: page.htmlTitle ?? "",
            meta_desc: page.metaDescription ?? "",
          }
        })}],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: update_page_content ────────────────────────────────────────────────
server.tool(
  "update_page_content",
  "Update the content of an existing HubSpot landing page without creating a new page",
  {
    portal_id: z.string().describe("HubSpot portal ID"),
    page_id: z.string().describe("HubSpot page ID to update"),
    name: z.string().optional().describe("New internal page name"),
    html_title: z.string().optional().describe("New SEO title"),
    meta_description: z.string().optional().describe("New meta description"),
    slug: z.string().optional().describe("New URL slug"),
    template_path: z.string().optional().describe("New template path"),
    widgets: z.string().optional().describe("JSON string of module widget overrides"),
  },
  async ({ portal_id, page_id, name, html_title, meta_description, slug, template_path, widgets }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const body = {};
      if (name) body.name = name;
      if (html_title) body.htmlTitle = html_title;
      if (meta_description) body.metaDescription = meta_description;
      if (slug) body.slug = slug;
      if (template_path) body.templatePath = template_path;
      if (widgets) {
        try { body.layoutSections = JSON.parse(widgets); }
        catch { throw new Error("widgets must be valid JSON"); }
      }
      if (Object.keys(body).length === 0) throw new Error("No fields provided.");
      const res = await fetch(
        \`https://api.hubapi.com/cms/v3/pages/landing-pages/\${page_id}\`,
        {
          method: "PATCH",
          headers: { Authorization: \`Bearer \${token}\`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) throw new Error(\`HubSpot API error: \${res.status} \${await res.text()}\`);
      const page = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify({
          status: "ok",
          page_id: page.id,
          page_name: page.name,
          slug: page.slug,
          draft_url: \`https://app.hubspot.com/pages/\${portal_id}/editor/\${page.id}\`,
          updated_fields: Object.keys(body),
        })}],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: web_search ─────────────────────────────────────────────────────────
server.tool(
  "web_search",
  "Search the web using the Anthropic API with web search enabled",
  {
    query: z.string().describe("Search query"),
    context: z.string().default("").describe("Optional context about why you are searching"),
  },
  async ({ query, context }) => {
    try {
      const envFile = path.join(__dirname, ".env");
      const envRaw = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
      const anthropicKey = (() => {
        for (const line of envRaw.split("\\n")) {
          const m = line.match(/^ANTHROPIC_API_KEY=(.*)$/);
          if (m) return m[1].trim();
        }
        return process.env.ANTHROPIC_API_KEY || "";
      })();
      if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not set in .env");
      const userMessage = context ? \`Search for: \${query}\\nContext: \${context}\` : \`Search for: \${query}\`;
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 2000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: userMessage }],
        }),
      });
      if (!response.ok) throw new Error(\`Anthropic API error: \${response.status} \${await response.text()}\`);
      const data = await response.json();
      const text = data.content.filter(b => b.type === "text").map(b => b.text).join("\\n");
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "ok", query, result: text }) }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── START ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
`;

const final = base + newTail;
fs.writeFileSync(indexPath, final, 'utf8');

// Verify
const verify = fs.readFileSync(indexPath, 'utf8');
const tools = ['get_page', 'update_page_content', 'web_search'];
tools.forEach(t => {
  const found = verify.includes(`"${t}"`);
  console.log(found ? `✓ ${t}` : `✗ ${t} MISSING`);
});
console.log(`\nTotal server.tool calls: ${(verify.match(/server\.tool\(/g) || []).length}`);
console.log('Done — restart Claude Desktop');
