import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const indexPath = path.join(__dirname, '..', 'index.js');
let idx = fs.readFileSync(indexPath, 'utf8');

const newTools = `
// ─── TOOL: get_page ────────────────────────────────────────────────────────────
server.tool(
  "get_page",
  "Get the current content and module field values of an existing HubSpot landing page",
  {
    portal_id: z.string().describe("HubSpot portal ID"),
    page_id:   z.string().describe("HubSpot page ID"),
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

      // Extract the most useful fields for iteration
      const summary = {
        id:           page.id,
        name:         page.name,
        slug:         page.slug,
        state:        page.state,
        template:     page.templatePath,
        updated:      page.updatedAt,
        draft_url:    \`https://app.hubspot.com/pages/\${portal_id}/editor/\${page.id}\`,
        // Module content — keyed by module path/id
        widgets:      page.layoutSections ?? {},
        meta_title:   page.htmlTitle ?? "",
        meta_desc:    page.metaDescription ?? "",
      };

      return {
        content: [{ type: "text", text: JSON.stringify({ status: "ok", page: summary }) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
      };
    }
  }
);

// ─── TOOL: update_page_content ─────────────────────────────────────────────────
server.tool(
  "update_page_content",
  "Update the content of an existing HubSpot landing page — change name, meta, or module field values without creating a new page",
  {
    portal_id:    z.string().describe("HubSpot portal ID"),
    page_id:      z.string().describe("HubSpot page ID to update"),
    name:         z.string().optional().describe("New internal page name"),
    html_title:   z.string().optional().describe("New SEO/browser tab title"),
    meta_description: z.string().optional().describe("New meta description"),
    slug:         z.string().optional().describe("New URL slug, e.g. /new-slug"),
    template_path: z.string().optional().describe("New template path if switching theme, e.g. ThemeName/templates/layout/base.html"),
    widgets:      z.record(z.any()).optional().describe("Module widget overrides keyed by widget path/id — use get_page first to see existing widget keys"),
  },
  async ({ portal_id, page_id, name, html_title, meta_description, slug, template_path, widgets }) => {
    try {
      const token = await getValidAccessToken(portal_id);

      // Build patch body — only include fields that were provided
      const body = {};
      if (name)             body.name = name;
      if (html_title)       body.htmlTitle = html_title;
      if (meta_description) body.metaDescription = meta_description;
      if (slug)             body.slug = slug;
      if (template_path)    body.templatePath = template_path;
      if (widgets)          body.layoutSections = widgets;

      if (Object.keys(body).length === 0) {
        throw new Error("No fields provided to update. Pass at least one of: name, html_title, meta_description, slug, template_path, widgets.");
      }

      const res = await fetch(
        \`https://api.hubapi.com/cms/v3/pages/landing-pages/\${page_id}\`,
        {
          method: "PATCH",
          headers: {
            Authorization: \`Bearer \${token}\`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) throw new Error(\`HubSpot API error: \${res.status} \${await res.text()}\`);
      const page = await res.json();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status:    "ok",
            page_id:   page.id,
            page_name: page.name,
            slug:      page.slug,
            draft_url: \`https://app.hubspot.com/pages/\${portal_id}/editor/\${page.id}\`,
            updated_fields: Object.keys(body),
          }),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
      };
    }
  }
);

`;

// Insert before the START marker
const startMarker = '// ─── START ────────────────────────────────────────────────────────────────────';
if (!idx.includes('get_page') && idx.includes(startMarker)) {
  idx = idx.replace(startMarker, newTools + startMarker);
  fs.writeFileSync(indexPath, idx, 'utf8');
  console.log('✓ get_page and update_page_content tools added to index.js');
} else if (idx.includes('get_page')) {
  console.log('✓ Tools already present');
} else {
  console.log('✗ START marker not found — check index.js');
}
