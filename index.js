import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { getValidAccessToken, listAuthorisedPortals } from "./auth.js";
import { generateTheme, collectFiles } from "./lp-theme-generic/generate.js";
import {
  generateEmailTemplate,
  writeTemplateHtml as writeEmailTemplateHtml,
  collectFiles as collectEmailTemplateFiles,
} from "./email-template-generic/generate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = new McpServer({
  name: "hs-lp-generator",
  version: "0.1.0",
});

// Map a `page_type` parameter to the HubSpot Pages API resource segment.
// Accepts "landing" (default) or "site". Throws on anything else.
function pagesResource(page_type) {
  const t = (page_type || "landing").toLowerCase();
  if (t === "landing" || t === "landing-page" || t === "lp") return "landing-pages";
  if (t === "site" || t === "site-page" || t === "website" || t === "website-page") return "site-pages";
  throw new Error(`Invalid page_type: "${page_type}". Must be "landing" or "site".`);
}

server.tool(
  "write_file",
  "Write a file directly to the local filesystem",
  {
    file_path: z.string().describe("Absolute path to write the file to"),
    content:   z.string().describe("File content to write"),
  },
  async ({ file_path, content }) => {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, content, "utf8");
    return { content: [{ type: "text", text: JSON.stringify({ status: "ok", path: file_path }) }] };
  }
);
// ─── TOOL: list_themes ───────────────────────────────────────────────────────
server.tool(
  "list_themes",
  "List all available themes in the connected HubSpot portal",
  {
    portal_id: z.string().describe("HubSpot portal ID to query. Use 'list' to see authorised portals."),
  },
  async ({ portal_id }) => {
    if (portal_id === "list") {
      const portals = listAuthorisedPortals();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ authorised_portals: portals }),
        }],
      };
    }

    try {
      const token = await getValidAccessToken(portal_id);
      const res = await fetch(
        "https://api.hubapi.com/cms/v3/source-code/published/metadata/@root",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`HubSpot API error: ${res.status} ${await res.text()}`);
      const data = await res.json();

      const children = data.children || [];
      const themeChecks = await Promise.all(
        children.map(async (name) => {
          const check = await fetch(
            `https://api.hubapi.com/cms/v3/source-code/published/metadata/${encodeURIComponent(name)}/theme.json`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          return check.ok ? name : null;
        })
      );
      const themes = themeChecks.filter(Boolean);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ portal_id, themes }),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
      };
    }
  }
);

// ─── TOOL: get_forms ─────────────────────────────────────────────────────────
server.tool(
  "get_forms",
  "List all HubSpot forms available in the portal for embedding in the LP hero",
  {
    portal_id: z.string().describe("HubSpot portal ID to query"),
  },
  async ({ portal_id }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const res = await fetch(
        "https://api.hubapi.com/marketing/v3/forms?limit=50",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`HubSpot API error: ${res.status} ${await res.text()}`);
      const data = await res.json();

      const forms = (data.results || []).map((f) => ({
        id: f.id,
        name: f.name,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ portal_id, total: forms.length, forms }),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
      };
    }
  }
);

// ─── TOOL: generate_lp ───────────────────────────────────────────────────────
server.tool(
  "generate_lp",
  "Generate a complete HubSpot landing page theme folder from brand and content inputs",
  {
    brand: z.object({
      company_name:    z.string(),
      theme_label:     z.string().describe("Theme name in HubSpot, e.g. Acme LP 2026"),
      logo_url:        z.string().default("").describe("HubSpot CDN URL for the logo (from upload_image)"),
      primary_color:   z.string().describe("Hex colour, e.g. #1A2E4A"),
      secondary_color: z.string().describe("Hex colour for backgrounds/gradients"),
      accent_color:    z.string().describe("Hex colour for buttons and highlights"),
      font_heading:    z.string().describe("Google Font name for headings"),
      font_body:       z.string().describe("Google Font name for body text"),
      border_radius:   z.string().default("6px"),
    }),
    content: z.object({
      form_id:               z.string().describe("HubSpot form GUID to embed in the hero"),
      hero_headline:         z.string(),
      hero_subheadline:      z.string(),
      hero_image_url:        z.string().default("").describe("HubSpot CDN URL for hero background image"),
      text_image_sections:   z.array(z.object({
        headline:   z.string(),
        body:       z.string(),
        image_url:  z.string().default(""),
      })).default([]).describe("One or more text+image sections — layout alternates automatically"),
      about_headline:        z.string(),
      about_body:            z.string(),
      about_image_url:       z.string().default("").describe("HubSpot CDN URL for about section image"),
      testimonials_headline: z.string().default("What our clients say"),
      testimonials:          z.array(z.object({
        quote:   z.string(),
        author:  z.string(),
        company: z.string().default(""),
      })).default([]).describe("Pre-populated testimonial entries"),
      cta_headline:          z.string(),
      cta_button_label:      z.string(),
      footer_copyright:      z.string(),
      sections:              z.array(z.object({
        type:             z.string().describe("Module type: header|hero|text-image|card-grid|feature-grid|about|stats|testimonials|faq|logo-carousel|cta|footer"),
        layout:           z.string().default(""),
        title:            z.string().default(""),
        intro:            z.string().default(""),
        headline:         z.string().default(""),
        body:             z.string().default(""),
        image_url:        z.string().default(""),
        has_form:         z.boolean().default(false),
        has_background_image: z.boolean().default(false),
        columns:          z.number().default(3),
        image_style:      z.string().default("rounded"),
        icon_style:       z.string().default("circle"),
        card_background:  z.string().default("none"),
        background:       z.string().default("primary"),
        module_name:      z.string().default(""),
        cards:            z.array(z.object({
          title:     z.string().default(""),
          body:      z.string().default(""),
          image_url: z.string().default(""),
          link_label: z.string().default(""),
          link_url:  z.string().default(""),
        })).default([]),
        items:            z.array(z.object({
          title:    z.string().default(""),
          body:     z.string().default(""),
          icon_url: z.string().default(""),
          question: z.string().default(""),
          answer:   z.string().default(""),
        })).default([]),
        stats:            z.array(z.object({
          number: z.string().default(""),
          label:  z.string().default(""),
          suffix: z.string().default(""),
        })).default([]),
        logos:            z.array(z.object({
          name:      z.string().default(""),
          image_url: z.string().default(""),
        })).default([]),
      })).default([]).describe("Manifest-driven section list — overrides legacy fields when provided"),
    }),
  },
  async ({ brand, content }) => {
    try {
      const outputPath = generateTheme(brand, content);
      const files = collectFiles(outputPath);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ok",
            theme_label: brand.theme_label,
            output_path: outputPath,
            file_count: files.length,
            files: files.map((f) => f.relativePath),
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

// ─── TOOL: upload_theme ───────────────────────────────────────────────────────
server.tool(
  "upload_theme",
  "Upload the generated theme folder to HubSpot via the Source Code API",
  {
    portal_id:  z.string().describe("HubSpot portal ID to upload to"),
    theme_path: z.string().describe("Absolute local path to the generated theme folder"),
    theme_name: z.string().describe("Destination folder name in HubSpot Design Manager"),
  },
  async ({ portal_id, theme_path, theme_name }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const files = collectFiles(theme_path);

      const results = [];
      let failed = 0;

      for (const file of files) {
        const hubspotPath = `${theme_name}/${file.relativePath}`;
        // Encode each path segment separately to preserve slashes
        const encodedPath = hubspotPath
          .split("/")
          .map((seg) => encodeURIComponent(seg))
          .join("/");

        const fileBuffer = fs.readFileSync(file.absolutePath);
        const blob = new Blob([fileBuffer]);
        const formData = new FormData();
        formData.append("file", blob, path.basename(file.absolutePath));

        const res = await fetch(
          `https://api.hubapi.com/cms/v3/source-code/published/content/${encodedPath}`,
          {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          }
        );

        if (res.ok) {
          results.push({ path: hubspotPath, status: "uploaded" });
        } else {
          const errText = await res.text();
          results.push({ path: hubspotPath, status: "failed", error: errText });
          failed++;
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: failed === 0 ? "ok" : "partial",
            portal_id,
            theme_name,
            uploaded: results.filter((r) => r.status === "uploaded").length,
            failed,
            results,
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

// ─── TOOL: create_page ────────────────────────────────────────────────────────
server.tool(
  "create_page",
  "Create a draft page in HubSpot using the uploaded theme template. Supports landing pages and site (website) pages.",
  {
    portal_id:  z.string().describe("HubSpot portal ID"),
    page_name:  z.string().describe("Internal name for the page in HubSpot"),
    page_slug:  z.string().describe("URL slug, e.g. /campaign-q3"),
    theme_name: z.string().describe("Theme folder name as uploaded to HubSpot"),
    page_type:  z.enum(["landing", "site"]).default("landing").describe("Page type: 'landing' for landing pages, 'site' for website/site pages. Defaults to 'landing'."),
  },
  async ({ portal_id, page_name, page_slug, theme_name, page_type }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const resource = pagesResource(page_type);
      const templatePath = `${theme_name}/templates/layout/base.html`;

      const body = {
        name: page_name,
        slug: page_slug.startsWith("/") ? page_slug.slice(1) : page_slug,
        templatePath,
        state: "DRAFT",
      };

      const res = await fetch(
        `https://api.hubapi.com/cms/v3/pages/${resource}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) throw new Error(`HubSpot API error: ${res.status} ${await res.text()}`);
      const page = await res.json();

      const draftUrl = `https://app.hubspot.com/pages/${portal_id}/editor/${page.id}`;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ok",
            page_id: page.id,
            page_name: page.name,
            page_type: resource === "site-pages" ? "site" : "landing",
            slug: page.slug,
            draft_url: draftUrl,
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

// ─── TOOL: upload_image ───────────────────────────────────────────────────────
server.tool(
  "upload_image",
  "Upload a local image file to the HubSpot File Manager and return its URL",
  {
    portal_id:  z.string().describe("HubSpot portal ID"),
    file_path:  z.string().describe("Absolute local path to the image file"),
    folder_name: z.string().default("lp-generator").describe("Folder name in HubSpot File Manager"),
  },
  async ({ portal_id, file_path, folder_name }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const fileName = path.basename(file_path);
      const fileBuffer = fs.readFileSync(file_path);
      const blob = new Blob([fileBuffer]);

      const formData = new FormData();
      formData.append("file", blob, fileName);
      formData.append("folderPath", `/${folder_name}`);
      formData.append("options", JSON.stringify({
        access: "PUBLIC_INDEXABLE",
        overwrite: true,
      }));

      const res = await fetch(
        "https://api.hubapi.com/files/v3/files",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        }
      );

      if (!res.ok) throw new Error(`HubSpot Files API error: ${res.status} ${await res.text()}`);
      const data = await res.json();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ok",
            file_id: data.id,
            file_name: data.name,
            url: data.url,
            portal_id,
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

// ─── TOOL: scan_images ───────────────────────────────────────────────────────
server.tool(
  "scan_images",
  "Scan a local folder for images and upload them to HubSpot File Manager, returning URLs keyed by filename",
  {
    portal_id:   z.string().describe("HubSpot portal ID"),
    folder_path: z.string().describe("Absolute local path to folder containing images"),
    folder_name: z.string().default("lp-generator").describe("HubSpot File Manager folder name"),
  },
  async ({ portal_id, folder_path, folder_name }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const SUPPORTED = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"]);

      if (!fs.existsSync(folder_path)) {
        throw new Error(`Folder not found: ${folder_path}`);
      }

      const entries = fs.readdirSync(folder_path, { withFileTypes: true })
        .filter(e => e.isFile() && SUPPORTED.has(path.extname(e.name).toLowerCase()));

      if (entries.length === 0) {
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "empty", message: "No supported images found in folder" }) }],
        };
      }

      const results = [];
      for (const entry of entries) {
        const filePath = path.join(folder_path, entry.name);
        const fileBuffer = fs.readFileSync(filePath);
        const blob = new Blob([fileBuffer]);
        const formData = new FormData();
        formData.append("file", blob, entry.name);
        formData.append("folderPath", `/${folder_name}`);
        formData.append("options", JSON.stringify({ access: "PUBLIC_INDEXABLE", overwrite: true }));

        const res = await fetch("https://api.hubapi.com/files/v3/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (res.ok) {
          const data = await res.json();
          results.push({ filename: entry.name, url: data.url, file_id: data.id });
        } else {
          results.push({ filename: entry.name, error: await res.text() });
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ status: "ok", count: results.length, images: results }) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
      };
    }
  }
);

// ─── TOOL: search_stock_image ─────────────────────────────────────────────────
server.tool(
  "search_stock_image",
  "Search Pexels for a stock image, download the best result, upload it to HubSpot File Manager and return the URL",
  {
    portal_id:   z.string().describe("HubSpot portal ID"),
    query:       z.string().describe("Search query, e.g. 'nail salon luxury London'"),
    folder_name: z.string().default("lp-generator").describe("HubSpot File Manager folder name"),
    orientation: z.enum(["landscape", "portrait", "square"]).default("landscape"),
  },
  async ({ portal_id, query, folder_name, orientation }) => {
    try {
      const pexelsKey = (() => {
        const envFile = path.join(__dirname, ".env");
        const raw = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
        for (const line of raw.split("\n")) {
          const m = line.match(/^PEXELS_API_KEY=(.*)$/);
          if (m) return m[1].trim();
        }
        return process.env.PEXELS_API_KEY || "";
      })();

      if (!pexelsKey) throw new Error("PEXELS_API_KEY not set in .env");

      // Search Pexels
      const searchRes = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=${orientation}`,
        { headers: { Authorization: pexelsKey } }
      );
      if (!searchRes.ok) throw new Error(`Pexels API error: ${searchRes.status}`);
      const searchData = await searchRes.json();

      if (!searchData.photos?.length) {
        throw new Error(`No Pexels results for: ${query}`);
      }

      // Pick the best result (first, highest quality)
      const photo = searchData.photos[0];
      const imageUrl = photo.src.large2x || photo.src.large;
      const fileName = `pexels-${photo.id}-${query.replace(/\s+/g, "-").toLowerCase()}.jpg`;

      // Download the image
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error(`Failed to download image from Pexels`);
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

      // Upload to HubSpot File Manager
      const token = await getValidAccessToken(portal_id);
      const blob = new Blob([imgBuffer], { type: "image/jpeg" });
      const formData = new FormData();
      formData.append("file", blob, fileName);
      formData.append("folderPath", `/${folder_name}`);
      formData.append("options", JSON.stringify({ access: "PUBLIC_INDEXABLE", overwrite: true }));

      const uploadRes = await fetch("https://api.hubapi.com/files/v3/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!uploadRes.ok) throw new Error(`HubSpot upload error: ${uploadRes.status} ${await uploadRes.text()}`);
      const uploadData = await uploadRes.json();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ok",
            query,
            pexels_id: photo.id,
            photographer: photo.photographer,
            pexels_url: photo.url,
            hubspot_url: uploadData.url,
            file_id: uploadData.id,
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

// ─── TOOL: update_page ────────────────────────────────────────────────────────
server.tool(
  "update_page",
  "Update an existing draft page in HubSpot to use a new theme template. Supports landing pages and site (website) pages.",
  {
    portal_id:  z.string().describe("HubSpot portal ID"),
    page_id:    z.string().describe("HubSpot page ID to update"),
    theme_name: z.string().describe("Theme folder name as uploaded to HubSpot"),
    page_type:  z.enum(["landing", "site"]).default("landing").describe("Page type: 'landing' for landing pages, 'site' for website/site pages. Defaults to 'landing'."),
  },
  async ({ portal_id, page_id, theme_name, page_type }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const resource = pagesResource(page_type);
      const templatePath = `${theme_name}/templates/layout/base.html`;

      const res = await fetch(
        `https://api.hubapi.com/cms/v3/pages/${resource}/${page_id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ templatePath }),
        }
      );

      if (!res.ok) throw new Error(`HubSpot API error: ${res.status} ${await res.text()}`);
      const page = await res.json();

      const draftUrl = `https://app.hubspot.com/pages/${portal_id}/editor/${page.id}`;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ok",
            page_id: page.id,
            page_name: page.name,
            page_type: resource === "site-pages" ? "site" : "landing",
            draft_url: draftUrl,
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

// ─── TOOL: analyse_wireframe ──────────────────────────────────────────────────
server.tool(
  "analyse_wireframe",
  "Analyse a wireframe image and return a structured section manifest for generate_lp",
  {
    image_path: z.string().describe("Absolute local path to the wireframe image"),
    context:    z.string().default("").describe("Optional context about the page purpose, industry, or client"),
  },
  async ({ image_path, context }) => {
    try {
      if (!fs.existsSync(image_path)) {
        throw new Error(`Image not found: ${image_path}`);
      }

      const imageBuffer = fs.readFileSync(image_path);
      const base64 = imageBuffer.toString("base64");
      const ext = path.extname(image_path).toLowerCase().slice(1);
      const mediaType = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
        : ext === "png" ? "image/png"
        : ext === "webp" ? "image/webp"
        : "image/png";

      const systemPrompt = `You are a expert web developer analysing a wireframe or design mockup to extract its structure.

Your job is to return a JSON array of sections representing the page layout from top to bottom.

Each section must have a "type" field from this exact list:
- "header" — logo bar at the top
- "hero" — main hero section (may include a form, headline, subheadline, background image)
- "text-image" — two column section with text on one side and image on the other
- "card-grid" — grid of cards (2, 3, or 4 columns), each with optional image, title, body
- "feature-grid" — grid of features/icons with label and description (typically circular or icon images)
- "about" — company/team about section, usually text + image
- "stats" — row of numerical statistics or key figures
- "testimonials" — client quotes/testimonials section
- "logo-carousel" — strip of client/partner logos
- "faq" — accordion of questions and answers
- "cta" — call to action section with headline and button
- "footer" — bottom bar with logo and copyright

For each section also include:
- "layout": brief description of the visual layout (e.g. "3-column", "image-right", "full-width")
- "notes": any specific observations about content, style, or intent
- For card-grid: include "columns" (2/3/4), "image_style" ("square"/"rounded"/"circle"), "card_background" ("none"/"light"/"primary"/"accent")
- For feature-grid: include "columns" (2/3/4), "icon_style" ("circle"/"rounded"/"square"/"icon-only")
- For hero: include "has_form" (boolean), "has_background_image" (boolean)
- For stats: include "count" (number of stats visible)

Return ONLY a valid JSON array. No explanation, no markdown, no backticks.`;

      const userPrompt = context
        ? `Analyse this wireframe. Context: ${context}`
        : "Analyse this wireframe and return the section manifest.";

      // Read API key fresh from .env file each call
      const envFile = path.join(__dirname, ".env");
      const envRaw = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
      const anthropicKey = (() => {
        for (const line of envRaw.split("\n")) {
          const m = line.match(/^ANTHROPIC_API_KEY=(.*)$/);
          if (m) return m[1].trim();
        }
        return process.env.ANTHROPIC_API_KEY || "";
      })();

      if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not set in .env");

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-opus-4-5",
          max_tokens: 2000,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mediaType,
                    data: base64,
                  },
                },
                {
                  type: "text",
                  text: userPrompt,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      const raw = data.content?.[0]?.text || "[]";

      // Parse and validate
      let manifest;
      try {
        manifest = JSON.parse(raw);
        if (!Array.isArray(manifest)) throw new Error("Not an array");
      } catch {
        throw new Error(`Failed to parse manifest from Claude response: ${raw.slice(0, 200)}`);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ok",
            section_count: manifest.length,
            manifest,
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







// ─── TOOL: get_page ───────────────────────────────────────────────────────────
server.tool(
  "get_page",
  "Get the current content and module field values of an existing HubSpot page. Supports landing pages and site (website) pages.",
  {
    portal_id: z.string().describe("HubSpot portal ID"),
    page_id: z.string().describe("HubSpot page ID"),
    page_type: z.enum(["landing", "site"]).default("landing").describe("Page type: 'landing' for landing pages, 'site' for website/site pages. Defaults to 'landing'."),
  },
  async ({ portal_id, page_id, page_type }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const resource = pagesResource(page_type);
      const res = await fetch(
        `https://api.hubapi.com/cms/v3/pages/${resource}/${page_id}?archived=false`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`HubSpot API error: ${res.status} ${await res.text()}`);
      const page = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify({
          status: "ok",
          page: {
            id: page.id,
            name: page.name,
            slug: page.slug,
            state: page.state,
            page_type: resource === "site-pages" ? "site" : "landing",
            template: page.templatePath,
            updated: page.updatedAt,
            draft_url: `https://app.hubspot.com/pages/${portal_id}/editor/${page.id}`,
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
  "Update the content of an existing HubSpot page without creating a new one. Supports landing pages and site (website) pages. Pass empty string to skip a field.",
  {
    portal_id: z.string().describe("HubSpot portal ID"),
    page_id: z.string().describe("HubSpot page ID to update"),
    page_type: z.enum(["landing", "site"]).default("landing").describe("Page type: 'landing' for landing pages, 'site' for website/site pages. Defaults to 'landing'."),
    name: z.string().describe("New page name, or empty string to skip"),
    html_title: z.string().describe("New SEO title, or empty string to skip"),
    meta_description: z.string().describe("New meta description, or empty string to skip"),
    slug: z.string().describe("New URL slug, or empty string to skip"),
    template_path: z.string().describe("New template path, or empty string to skip"),
    widgets: z.string().describe("JSON string of module widget overrides, or empty string to skip"),
  },
  async ({ portal_id, page_id, page_type, name, html_title, meta_description, slug, template_path, widgets }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const resource = pagesResource(page_type);
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
        `https://api.hubapi.com/cms/v3/pages/${resource}/${page_id}`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) throw new Error(`HubSpot API error: ${res.status} ${await res.text()}`);
      const page = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify({
          status: "ok",
          page_id: page.id,
          page_name: page.name,
          page_type: resource === "site-pages" ? "site" : "landing",
          slug: page.slug,
          draft_url: `https://app.hubspot.com/pages/${portal_id}/editor/${page.id}`,
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
    context: z.string().describe("Optional context about why you are searching, or empty string"),
  },
  async ({ query, context }) => {
    try {
      const envFile = path.join(__dirname, ".env");
      const envRaw = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
      const anthropicKey = (() => {
        for (const line of envRaw.split("\n")) {
          const m = line.match(/^ANTHROPIC_API_KEY=(.*)$/);
          if (m) return m[1].trim();
        }
        return process.env.ANTHROPIC_API_KEY || "";
      })();
      if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not set in .env");
      const userMessage = context ? `Search for: ${query}\nContext: ${context}` : `Search for: ${query}`;
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
      if (!response.ok) throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
      const data = await response.json();
      const text = data.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "ok", query, result: text }) }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: list_emails ────────────────────────────────────────────────────────
server.tool(
  "list_emails",
  "List marketing emails in a HubSpot portal, with optional status filter",
  {
    portal_id: z.string().describe("HubSpot portal ID"),
    status: z.enum(["DRAFT", "PUBLISHED", "SCHEDULED", "ALL"]).default("ALL").describe("Filter by email status. Defaults to ALL."),
    limit: z.number().default(20).describe("Max number of emails to return (default 20, max 100)"),
  },
  async ({ portal_id, status, limit }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const params = new URLSearchParams({
        limit: String(Math.min(limit, 100)),
        orderBy: "-updated",
      });
      if (status !== "ALL") params.append("state", status);

      const res = await fetch(
        `https://api.hubapi.com/marketing/v3/emails?${params}`,
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      if (!res.ok) throw new Error(`HubSpot API error: ${res.status} ${await res.text()}`);
      const data = await res.json();

      const emails = (data.results || []).map((e) => ({
        id: e.id,
        name: e.name,
        subject: e.subject,
        status: e.state,
        updated: e.updatedAt,
        from_name: e.fromName,
        from_email: e.fromEmail,
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ status: "ok", portal_id, total: emails.length, emails }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: get_email ──────────────────────────────────────────────────────────
server.tool(
  "get_email",
  "Get the full content and settings of an existing HubSpot marketing email by ID",
  {
    portal_id: z.string().describe("HubSpot portal ID"),
    email_id:  z.string().describe("HubSpot email ID"),
  },
  async ({ portal_id, email_id }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const res = await fetch(
        `https://api.hubapi.com/marketing/v3/emails/${email_id}`,
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      if (!res.ok) throw new Error(`HubSpot API error: ${res.status} ${await res.text()}`);
      const e = await res.json();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ok",
            email: {
              id: e.id,
              name: e.name,
              subject: e.subject,
              preview_text: e.previewText,
              status: e.state,
              from_name: e.fromName,
              from_email: e.fromEmail,
              html_body: e.content?.body || "",
              plain_text_body: e.content?.plainTextBody || "",
              campaign_id: e.campaignId || null,
              updated: e.updatedAt,
              created: e.createdAt,
            },
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: create_email ───────────────────────────────────────────────────────
server.tool(
  "create_email",
  "Create a new draft marketing email in HubSpot. Either provide html_body for a freeform email, OR provide template_path (Design Manager path to an email template) to base the email on a reusable template. The two are mutually exclusive — exactly one must be non-empty.",
  {
    portal_id:       z.string().describe("HubSpot portal ID"),
    name:            z.string().describe("Internal email name (shown in HubSpot dashboard)"),
    subject:         z.string().describe("Email subject line"),
    preview_text:    z.string().default("").describe("Preview/preheader text shown in inbox"),
    from_name:       z.string().describe("Sender display name"),
    from_email:      z.string().describe("Sender email address (must be verified in HubSpot)"),
    html_body:       z.string().default("").describe("Full HTML body of the email — leave empty when using template_path"),
    plain_text_body: z.string().default("").describe("Plain text fallback body"),
    template_path:   z.string().default("").describe("Design Manager path to an email template (e.g. 'email-templates/cloudtech-generic/template.html'). Use list_email_templates to discover. Leave empty when supplying html_body."),
    campaign_id:     z.string().default("").describe("Optional HubSpot campaign ID, or empty string to skip"),
  },
  async ({ portal_id, name, subject, preview_text, from_name, from_email, html_body, plain_text_body, template_path, campaign_id }) => {
    try {
      // Mutual exclusivity: exactly one of html_body / template_path
      const hasHtml = Boolean(html_body);
      const hasTemplate = Boolean(template_path);
      if (hasHtml && hasTemplate) {
        throw new Error("Provide either 'html_body' OR 'template_path', not both.");
      }
      if (!hasHtml && !hasTemplate) {
        throw new Error("Provide either 'html_body' or 'template_path'.");
      }

      const token = await getValidAccessToken(portal_id);

      const contentBlock = hasTemplate
        ? { templatePath: template_path, plainTextBody: plain_text_body }
        : { body: html_body, plainTextBody: plain_text_body };

      const payload = {
        name,
        subject,
        previewText: preview_text,
        fromName: from_name,
        fromEmail: from_email,
        content: contentBlock,
        ...(campaign_id ? { campaignId: campaign_id } : {}),
      };

      const res = await fetch(
        "https://api.hubapi.com/marketing/v3/emails",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error(`HubSpot API error: ${res.status} ${await res.text()}`);
      const data = await res.json();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ok",
            email_id: data.id,
            name: data.name,
            subject: data.subject,
            state: data.state,
            edit_url: `https://app.hubspot.com/email/${portal_id}/edit/${data.id}`,
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: update_email_content ───────────────────────────────────────────────
server.tool(
  "update_email_content",
  "Update the content or settings of an existing HubSpot draft email. Pass empty string to skip a field.",
  {
    portal_id:       z.string().describe("HubSpot portal ID"),
    email_id:        z.string().describe("HubSpot email ID to update"),
    name:            z.string().describe("New internal email name, or empty string to skip"),
    subject:         z.string().describe("New subject line, or empty string to skip"),
    preview_text:    z.string().describe("New preview/preheader text, or empty string to skip"),
    from_name:       z.string().describe("New sender display name, or empty string to skip"),
    from_email:      z.string().describe("New sender email address, or empty string to skip"),
    html_body:       z.string().describe("New HTML body, or empty string to skip"),
    plain_text_body: z.string().describe("New plain text body, or empty string to skip"),
  },
  async ({ portal_id, email_id, name, subject, preview_text, from_name, from_email, html_body, plain_text_body }) => {
    try {
      const token = await getValidAccessToken(portal_id);

      const payload = {};
      if (name)         payload.name        = name;
      if (subject)      payload.subject     = subject;
      if (preview_text) payload.previewText = preview_text;
      if (from_name)    payload.fromName    = from_name;
      if (from_email)   payload.fromEmail   = from_email;

      const content = {};
      if (html_body)       content.body          = html_body;
      if (plain_text_body) content.plainTextBody = plain_text_body;
      if (Object.keys(content).length) payload.content = content;

      if (Object.keys(payload).length === 0) throw new Error("No fields provided.");

      const res = await fetch(
        `https://api.hubapi.com/marketing/v3/emails/${email_id}`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error(`HubSpot API error: ${res.status} ${await res.text()}`);
      const data = await res.json();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ok",
            email_id: data.id,
            name: data.name,
            subject: data.subject,
            state: data.state,
            updated_fields: Object.keys(payload),
            edit_url: `https://app.hubspot.com/email/${portal_id}/edit/${data.id}`,
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: read_file ──────────────────────────────────────────────────────────
server.tool(
  "read_file",
  "Read a UTF-8 text file from the local filesystem. Use for HubSpot module files (HTML/CSS/JSON) before modifying them. Not suitable for binary files.",
  {
    file_path: z.string().describe("Absolute path to the file to read"),
  },
  async ({ file_path }) => {
    try {
      if (!fs.existsSync(file_path)) {
        throw new Error(`File not found: ${file_path}`);
      }
      const stats = fs.statSync(file_path);
      if (stats.isDirectory()) {
        throw new Error(`Path is a directory, not a file: ${file_path}. Use list_files instead.`);
      }
      const content = fs.readFileSync(file_path, "utf8");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ok",
            path: file_path,
            size_bytes: stats.size,
            content,
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

// ─── TOOL: list_files ─────────────────────────────────────────────────────────
server.tool(
  "list_files",
  "List entries (files, directories, symlinks) in a local filesystem directory. Use to discover module files inside a theme folder.",
  {
    folder_path: z.string().describe("Absolute path to the directory to list"),
  },
  async ({ folder_path }) => {
    try {
      if (!fs.existsSync(folder_path)) {
        throw new Error(`Folder not found: ${folder_path}`);
      }
      const stats = fs.statSync(folder_path);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${folder_path}`);
      }
      const entries = fs.readdirSync(folder_path, { withFileTypes: true })
        .map((e) => {
          let type = "file";
          if (e.isDirectory()) type = "directory";
          else if (e.isSymbolicLink()) type = "symlink";
          const entry = { name: e.name, type };
          if (type === "file") {
            try {
              const s = fs.statSync(path.join(folder_path, e.name));
              entry.size_bytes = s.size;
            } catch {}
          }
          return entry;
        })
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ok",
            path: folder_path,
            count: entries.length,
            entries,
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

// ─── TOOL: generate_email_template ────────────────────────────────────────────
server.tool(
  "generate_email_template",
  "Generate a reusable HubSpot email template HTML file in a local folder, ready to upload to the Design Manager. Three modes: 'from_brief' renders the email-template-generic base layout populated with brand+content; 'from_html' wraps user-supplied raw HTML with the email-template metadata header; 'from_email' fetches an existing marketing email by ID and wraps its body as a reusable template.",
  {
    template_label: z.string().describe("Template label — used as folder name and HubSpot Design Manager name, e.g. 'CloudTech Email Generic'"),
    mode: z.enum(["from_brief", "from_html", "from_email"]).describe("Authoring mode"),
    // from_brief inputs
    brand: z.object({
      company_name:    z.string().default(""),
      logo_url:        z.string().default(""),
      primary_color:   z.string().default("#1A2E4A"),
      secondary_color: z.string().default("#F4F4F4"),
      accent_color:    z.string().default("#EF3E2D"),
      font_heading:    z.string().default("Arial"),
      font_body:       z.string().default("Arial"),
      border_radius:   z.string().default("6px"),
    }).default({}).describe("Brand tokens (used when mode=from_brief)"),
    content: z.object({
      hero_headline: z.string().default(""),
      hero_body:     z.string().default("<p></p>"),
      cta_label:     z.string().default("Get in touch"),
      cta_url:       z.string().default("#"),
      footer_text:   z.string().default(""),
    }).default({}).describe("Content tokens (used when mode=from_brief)"),
    // from_html input
    html: z.string().default("").describe("Raw HTML to wrap as a template (used when mode=from_html)"),
    // from_email inputs
    portal_id: z.string().default("").describe("HubSpot portal ID (required when mode=from_email)"),
    email_id:  z.string().default("").describe("Marketing email ID to clone (used when mode=from_email)"),
  },
  async ({ template_label, mode, brand, content, html, portal_id, email_id }) => {
    try {
      let outputPath;

      if (mode === "from_brief") {
        outputPath = generateEmailTemplate({ ...brand, template_label }, content);
      } else if (mode === "from_html") {
        if (!html) throw new Error("'html' is required when mode=from_html");
        outputPath = writeEmailTemplateHtml(template_label, html);
      } else if (mode === "from_email") {
        if (!portal_id) throw new Error("'portal_id' is required when mode=from_email");
        if (!email_id)  throw new Error("'email_id' is required when mode=from_email");
        const token = await getValidAccessToken(portal_id);
        const res = await fetch(
          `https://api.hubapi.com/marketing/v3/emails/${email_id}`,
          { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
        );
        if (!res.ok) throw new Error(`HubSpot API error fetching source email: ${res.status} ${await res.text()}`);
        const e = await res.json();
        const body = e.content?.body || "";
        if (!body) throw new Error(`Source email ${email_id} has no html body`);
        outputPath = writeEmailTemplateHtml(template_label, body);
      } else {
        throw new Error(`Unknown mode: ${mode}`);
      }

      const files = collectEmailTemplateFiles(outputPath);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ok",
            mode,
            template_label,
            output_path: outputPath,
            file_count: files.length,
            files: files.map((f) => f.relativePath),
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: upload_email_template ──────────────────────────────────────────────
server.tool(
  "upload_email_template",
  "Upload a generated email-template folder to the HubSpot Design Manager via the Source Code API. Once uploaded, the template can be selected when creating new marketing emails or referenced via create_email's template_path parameter.",
  {
    portal_id:      z.string().describe("HubSpot portal ID to upload to"),
    template_path:  z.string().describe("Absolute local path to the generated template folder"),
    template_name:  z.string().describe("Destination folder name in HubSpot Design Manager, e.g. 'email-templates/cloudtech-generic'"),
  },
  async ({ portal_id, template_path, template_name }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const files = collectEmailTemplateFiles(template_path);

      const results = [];
      let failed = 0;

      for (const file of files) {
        const hubspotPath = `${template_name}/${file.relativePath}`;
        const encodedPath = hubspotPath.split("/").map((seg) => encodeURIComponent(seg)).join("/");

        const fileBuffer = fs.readFileSync(file.absolutePath);
        const blob = new Blob([fileBuffer]);
        const formData = new FormData();
        formData.append("file", blob, path.basename(file.absolutePath));

        const res = await fetch(
          `https://api.hubapi.com/cms/v3/source-code/published/content/${encodedPath}`,
          { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: formData }
        );

        if (res.ok) {
          results.push({ path: hubspotPath, status: "uploaded" });
        } else {
          results.push({ path: hubspotPath, status: "failed", error: await res.text() });
          failed++;
        }
      }

      // The HubSpot template path that create_email references is the .html file path
      const templateHtmlPath = files
        .map((f) => `${template_name}/${f.relativePath}`)
        .find((p) => p.endsWith("template.html")) || `${template_name}/template.html`;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: failed === 0 ? "ok" : "partial",
            portal_id,
            template_name,
            uploaded: results.filter((r) => r.status === "uploaded").length,
            failed,
            template_path_for_create_email: templateHtmlPath,
            results,
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: list_email_templates ───────────────────────────────────────────────
server.tool(
  "list_email_templates",
  "List email templates available in the HubSpot Design Manager for the given portal. Returns top-level Design Manager folders that contain a template.html with an email_base_template metadata header.",
  {
    portal_id: z.string().describe("HubSpot portal ID"),
  },
  async ({ portal_id }) => {
    try {
      const token = await getValidAccessToken(portal_id);

      const rootRes = await fetch(
        "https://api.hubapi.com/cms/v3/source-code/published/metadata/@root",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!rootRes.ok) throw new Error(`HubSpot API error: ${rootRes.status} ${await rootRes.text()}`);
      const rootData = await rootRes.json();
      const candidates = rootData.children || [];

      // Probe each top-level folder for a template.html with the email metadata header
      const checks = await Promise.all(candidates.map(async (name) => {
        const probePath = `${name}/template.html`;
        const encoded = probePath.split("/").map(encodeURIComponent).join("/");
        const res = await fetch(
          `https://api.hubapi.com/cms/v3/source-code/published/content/${encoded}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) return null;
        const text = await res.text();
        if (/templateType:\s*email_base_template/i.test(text)) {
          const labelMatch = text.match(/label:\s*([^\n\r]+)/);
          return {
            folder: name,
            template_path: probePath,
            label: labelMatch ? labelMatch[1].trim() : name,
          };
        }
        return null;
      }));

      const templates = checks.filter(Boolean);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ status: "ok", portal_id, total: templates.length, templates }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: check_for_updates ──────────────────────────────────────────────────
server.tool(
  "check_for_updates",
  "Check whether the LP Generator MCP server has a newer version available on GitHub. Returns the current SHA, latest SHA on origin/main, and a list of new commits if behind. Call this only when the user explicitly asks to check for updates.",
  {},
  async () => {
    try {
      const installDir = __dirname;
      if (!fs.existsSync(path.join(installDir, ".git"))) {
        throw new Error(`Not a git checkout: ${installDir}`);
      }
      const run = (args) => execFileSync("git", args, { cwd: installDir, encoding: "utf8" }).trim();

      const current = run(["rev-parse", "--short", "HEAD"]);
      run(["fetch", "--quiet", "origin", "main"]);
      const latest = run(["rev-parse", "--short", "origin/main"]);

      if (current === latest) {
        return { content: [{ type: "text", text: JSON.stringify({ status: "up_to_date", current }) }] };
      }

      const log = run(["log", "--oneline", "--no-decorate", `${current}..origin/main`]);
      const commits = log.split("\n").filter(Boolean);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "update_available",
            current,
            latest,
            commit_count: commits.length,
            commits,
            instructions: "If the user wants to apply the update, call the update_self tool. They will need to restart Claude Desktop afterwards.",
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: update_self ────────────────────────────────────────────────────────
server.tool(
  "update_self",
  "Pull the latest version of the LP Generator MCP server from GitHub and refresh dependencies if package.json changed. After this runs the user MUST restart Claude Desktop (Cmd+Q, then reopen) to load the new code.",
  {},
  async () => {
    try {
      const installDir = __dirname;
      if (!fs.existsSync(path.join(installDir, ".git"))) {
        throw new Error(`Not a git checkout: ${installDir}`);
      }
      const runGit = (args) => execFileSync("git", args, { cwd: installDir, encoding: "utf8" }).trim();

      const before = runGit(["rev-parse", "--short", "HEAD"]);
      runGit(["fetch", "--quiet", "origin", "main"]);
      const remote = runGit(["rev-parse", "--short", "origin/main"]);

      if (before === remote) {
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "already_up_to_date", current: before }) }],
        };
      }

      // Check what's about to change so we know whether to reinstall deps
      const changed = runGit(["diff", "--name-only", `${before}..origin/main`])
        .split("\n").filter(Boolean);
      const needsNpmInstall = changed.some((f) => /^package(-lock)?\.json$/.test(f));

      // Apply
      runGit(["pull", "--quiet", "origin", "main"]);
      const after = runGit(["rev-parse", "--short", "HEAD"]);

      let npm_install = "skipped";
      if (needsNpmInstall) {
        try {
          execFileSync("npm", ["install", "--quiet"], { cwd: installDir, encoding: "utf8" });
          npm_install = "ok";
        } catch (e) {
          npm_install = `failed: ${e.stderr?.toString() || e.message}`;
        }
      }

      let syntax_check = "ok";
      try {
        execFileSync("node", ["--check", path.join(installDir, "index.js")], {
          cwd: installDir,
          encoding: "utf8",
        });
      } catch (e) {
        syntax_check = `failed: ${e.stderr?.toString() || e.message}`;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "updated",
            from: before,
            to: after,
            files_changed: changed.length,
            npm_install,
            syntax_check,
            restart_required: true,
            instructions: "Restart Claude Desktop (Cmd+Q, then reopen) to load the new code.",
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── START ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
