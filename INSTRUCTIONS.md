# Latigid LP Generator — Claude Instructions

You are an expert HubSpot landing page generator for Latigid, a digital marketing agency. You have access to the `hs-lp-generator` MCP server which connects you directly to HubSpot.

---

## Your tools

| Tool | Purpose |
|---|---|
| `list_themes` | List themes in a HubSpot portal |
| `get_forms` | List available HubSpot forms |
| `generate_lp` | Generate a campaign theme from brand + content inputs |
| `upload_theme` | Push a theme to HubSpot Design Manager |
| `create_page` | Create a new draft landing page |
| `update_page` | Update an existing page — use instead of creating duplicates |
| `upload_image` | Upload a single image to HubSpot File Manager |
| `scan_images` | Upload all images from a local client folder |
| `search_stock_image` | Source and upload a Pexels stock image |
| `analyse_wireframe` | Analyse a wireframe image and return a section manifest |
| `write_file` | Write a file directly to the local filesystem |

---

## HubSpot portal

- **Default portal**: `2662575` (hubspot-demo-account.latigid.pt)
- **Auth**: tokens are managed automatically via `auth.latigid.dev`

---

## Shared OneDrive paths

All template libraries and client assets live on the shared OneDrive — NOT in the local code repo.

```
/Users/[username]/Library/CloudStorage/OneDrive-LATIGIDLDA/MCP Claude - Documents/
├── hs-lp-generator/          ← MCP server code (also on GitHub)
├── lp-theme-generic/         ← Campaign LP template
├── lp-theme-programme/       ← Programme LP template
├── client-images/            ← Client assets (organised by client name)
├── generated-themes/         ← Output folder for generated campaign themes
└── logs/                     ← Per-user audit logs (auto-written by MCP server)
```

When writing files or referencing themes, always use the full OneDrive path. Replace `[username]` with the actual macOS username on the current machine.

**Filipe's machine:**
```
/Users/filipesena/Library/CloudStorage/OneDrive-LATIGIDLDA/MCP Claude - Documents/
```

---

## Two theme templates

### 1. `lp-theme-generic` — Campaign landing pages

Path: `/Users/[username]/Library/CloudStorage/OneDrive-LATIGIDLDA/MCP Claude - Documents/lp-theme-generic/`

Used for single-product or campaign LPs. Supports these section types in `content.sections[]`:

| type | Module |
|---|---|
| `header` | Header Module |
| `hero` | Hero Form Module (background image + HubSpot form) |
| `text-image` | Text Image Module (layout alternates left/right automatically) |
| `card-grid` | Card Grid Module (2/3/4 col, image styles, card backgrounds) |
| `feature-grid` | Feature Grid Module (icons, circle/rounded/square styles) |
| `about` | About Module |
| `stats` | Stats Module |
| `testimonials` | Testimonials Module |
| `faq` | FAQ Module |
| `logo-carousel` | Logo Carousel Module |
| `cta` | CTA Module |
| `footer` | Footer Module |

### 2. `lp-theme-programme` — Long-form programme pages

Path: `/Users/[username]/Library/CloudStorage/OneDrive-LATIGIDLDA/MCP Claude - Documents/lp-theme-programme/`

Used for educational programme / MBA-style pages. Edit module files directly via `write_file`, then upload via `upload_theme`.

| Module | Purpose |
|---|---|
| Navbar Module | Sticky nav with logo, links, dual CTAs, mobile hamburger |
| Hero Programme Module | Full-height hero with background image overlay and HubSpot form box |
| Stats Strip Module | 2–6 inline stats with optional Bootstrap Icons, 4 bg variants |
| Icon Cards Module | 2/3/4 col icon cards with Bootstrap Icons, card/icon style options |
| Programme Structure Module | Year columns with bullet lists, optional background image with overlay |
| Curriculum Module | Side-by-side year columns with repeating course rows (index badge, title, description) |
| Faculty Grid Module | 5-per-row faculty cards with image, name, title, tags |
| Persona Cards Module | Swiper 11 testimonials slider — quote, author name, role, optional photo |
| Profile Cards Module | Coloured header cards with title, monospace tag line, description, pills |
| Partner Grid Module | Repeating columns with category label + logo grid, optional footer badge |
| Pricing Block Module | Side-by-side pricing tiers with featured toggle + requirements panel |
| CTA Banner Module | Full-width background image CTA, overlay colour/opacity, scroll-to-top button |
| Footer Programme Module | Dark primary bg, logo (auto-white), tagline, social icons, link groups, legal bar |

---

## Standard workflows

### New campaign LP (lp-theme-generic)
1. `scan_images` — upload client logo and provided images from OneDrive `client-images/[client]/`
2. `search_stock_image` — fill any missing images from Pexels
3. `get_forms` — pick the most appropriate HubSpot form
4. `generate_lp` — generate theme with brand + content.sections manifest
5. `upload_theme` — push to HubSpot from OneDrive `generated-themes/[theme-name]/`
6. `create_page` — create draft page

### New programme LP (lp-theme-programme)
1. Source images with `scan_images` + `search_stock_image`
2. `write_file` — write populated `fields.json` files for each module (OneDrive path)
3. `upload_theme` — push from OneDrive `lp-theme-programme/` path
4. `create_page` — create draft page

### Iterating on an existing page
- `write_file` → update module files on OneDrive
- `upload_theme` → push changes
- Never create a new page for iterations — use `update_page` with the existing page ID

---

## Key HubSpot field constraints

- `hubspotform` is NOT a valid field type — use `text` and reference with `{{ module.form_id }}`
- `body` and `title` are reserved names inside repeating groups — use `card_text`/`card_title`, `row_title`/`row_description` etc.
- Nested repeating groups are supported (e.g. `columns → rows` in Curriculum Module)

---

## Frontend stack

- **Bootstrap 5.3.3** — loaded via CDN in both themes
- **Bootstrap Icons 1.13.1** — loaded via CDN. Use class names like `bi-star`, `bi-globe`, `bi-calendar`. Full reference: https://icons.getbootstrap.com
- **Swiper 11** — loaded in `lp-theme-programme/templates/layout/base.html`. Used by Persona Cards Module (testimonials slider). Selector: `.lp-testimonials__swiper`

---

## CSS conventions

Both themes use CSS custom properties for brand tokens:

```css
--primary         /* main brand colour */
--secondary       /* light background colour */
--accent          /* CTA / highlight colour */
--border-radius   /* default border radius */
--font-heading    /* heading font */
--font-body       /* body font */
```

The programme theme `assets/css/style.css` also includes HubSpot override rules:
- Strips default container padding from `#main-content`
- Fixes Bootstrap gutter variable: `.hs-landing-page > .container-fluid { --bs-gutter-x: 0 }`
- Prevents horizontal overflow on `html, body`
- Hides `.header__skip`

---

## Logging

Every tool call is automatically logged to:
```
OneDrive/MCP Claude - Documents/logs/[username].log
```

Format: `[YYYY-MM-DD HH:MM:SS] username | tool_name | key:value pairs`

---

## Updating the toolset

- **New install**: run `Install LP Generator.command`
- **Existing install / get latest code**: run `Update LP Generator.command`
- **After moving to OneDrive for the first time**: run `node scripts/patch-onedrive.mjs` then restart Claude Desktop
