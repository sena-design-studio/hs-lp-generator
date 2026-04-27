import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getValidAccessToken, listAuthorisedPortals } from "./auth.js";
import { generateTheme, collectFiles } from "./lp-theme-generic/generate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = new McpServer({
  name: "hs-lp-generator",
  version: "0.1.0",
});

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
  "Create a draft landing page in HubSpot using the uploaded theme template",
  {
    portal_id:  z.string().describe("HubSpot portal ID"),
    page_name:  z.string().describe("Internal name for the page in HubSpot"),
    page_slug:  z.string().describe("URL slug, e.g. /campaign-q3"),
    theme_name: z.string().describe("Theme folder name as uploaded to HubSpot"),
  },
  async ({ portal_id, page_name, page_slug, theme_name }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const templatePath = `${theme_name}/templates/layout/base.html`;

      const body = {
        name: page_name,
        slug: page_slug.startsWith("/") ? page_slug.slice(1) : page_slug,
        templatePath,
        state: "DRAFT",
      };

      const res = await fetch(
        "https://api.hubapi.com/cms/v3/pages/landing-pages",
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
  "Update an existing draft landing page in HubSpot to use a new theme template",
  {
    portal_id:  z.string().describe("HubSpot portal ID"),
    page_id:    z.string().describe("HubSpot page ID to update"),
    theme_name: z.string().describe("Theme folder name as uploaded to HubSpot"),
  },
  async ({ portal_id, page_id, theme_name }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const templatePath = `${theme_name}/templates/layout/base.html`;

      const res = await fetch(
        `https://api.hubapi.com/cms/v3/pages/landing-pages/${page_id}`,
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
  "Get the current content and module field values of an existing HubSpot landing page",
  {
    portal_id: z.string().describe("HubSpot portal ID"),
    page_id: z.string().describe("HubSpot page ID"),
  },
  async ({ portal_id, page_id }) => {
    try {
      const token = await getValidAccessToken(portal_id);
      const res = await fetch(
        `https://api.hubapi.com/cms/v3/pages/landing-pages/${page_id}?archived=false`,
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
  "Update the content of an existing HubSpot landing page without creating a new page. Pass empty string to skip a field.",
  {
    portal_id: z.string().describe("HubSpot portal ID"),
    page_id: z.string().describe("HubSpot page ID to update"),
    name: z.string().describe("New page name, or empty string to skip"),
    html_title: z.string().describe("New SEO title, or empty string to skip"),
    meta_description: z.string().describe("New meta description, or empty string to skip"),
    slug: z.string().describe("New URL slug, or empty string to skip"),
    template_path: z.string().describe("New template path, or empty string to skip"),
    widgets: z.string().describe("JSON string of module widget overrides, or empty string to skip"),
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
        `https://api.hubapi.com/cms/v3/pages/landing-pages/${page_id}`,
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

// ─── START ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
