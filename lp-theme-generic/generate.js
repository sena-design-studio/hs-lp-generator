import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "..", "generated-themes");

// ─── CSS + HTML token replacement ────────────────────────────────────────────

function buildTokenMap(brand) {
  const fontHeadingUrl = brand.font_heading.replace(/ /g, "+");
  const fontBodyUrl = brand.font_body.replace(/ /g, "+");
  const googleFontsUrl = `https://fonts.googleapis.com/css2?family=${fontHeadingUrl}:wght@400;700;900&family=${fontBodyUrl}:wght@300;400;600&display=swap`;

  return {
    "{{THEME_LABEL}}":      brand.theme_label,
    "{{PRIMARY_COLOR}}":    brand.primary_color,
    "{{SECONDARY_COLOR}}":  brand.secondary_color,
    "{{ACCENT_COLOR}}":     brand.accent_color,
    "{{FONT_HEADING}}":     brand.font_heading,
    "{{FONT_BODY}}":        brand.font_body,
    "{{GOOGLE_FONTS_URL}}": googleFontsUrl,
    "{{BORDER_RADIUS}}":    brand.border_radius || "6px",
  };
}

function applyTokens(str, tokens) {
  let result = str;
  for (const [token, value] of Object.entries(tokens)) {
    result = result.replaceAll(token, value);
  }
  return result;
}

// ─── Image field helper ───────────────────────────────────────────────────────

function imageDefault(url = "", alt = "") {
  return {
    size_type: "auto",
    src: url,
    alt: alt,
    loading: "lazy",
  };
}

// ─── Computed fields.json per module ─────────────────────────────────────────

function buildModuleFields(moduleName, brand, content) {
  const year = new Date().getFullYear();

  switch (moduleName) {

    case "Header Module.module":
      return [
        {
          id: "lp-header-logo",
          name: "logo",
          label: "Logo",
          required: false,
          locked: false,
          responsive: true,
          resizable: true,
          show_loading: false,
          display_width: null,
          type: "image",
          default: imageDefault(brand.logo_url || "", brand.company_name),
        },
      ];

    case "Hero Form Module.module":
      return [
        {
          id: "lp-hero-title",
          name: "module_title",
          label: "Headline",
          required: false,
          locked: false,
          allow_new_line: false,
          display_width: null,
          type: "text",
          default: content.hero_headline || "",
        },
        {
          id: "lp-hero-subtitle",
          name: "module_subtitle",
          label: "Subheadline",
          required: false,
          locked: false,
          allow_new_line: false,
          display_width: null,
          type: "text",
          default: content.hero_subheadline || "",
        },
        {
          id: "lp-hero-image",
          name: "featured_image",
          label: "Featured Image",
          required: false,
          locked: false,
          responsive: true,
          resizable: true,
          show_loading: false,
          display_width: null,
          type: "image",
          default: imageDefault(content.hero_image_url || "", content.hero_headline || ""),
        },
        {
          id: "lp-hero-form",
          name: "form_field",
          label: "Form",
          required: false,
          locked: false,
          embed_versions: ["v2", "v4"],
          display_width: null,
          type: "form",
          default: {
            form_id: content.form_id || "",
            response_type: "inline",
            message: "Thanks for submitting the form.",
          },
        },
        {
          id: "lp-hero-icon-toggle",
          name: "has_icon_row",
          label: "Show icon row?",
          required: false,
          locked: false,
          display: "toggle",
          display_width: null,
          type: "boolean",
          default: false,
        },
        {
          id: "lp-hero-icon-title",
          name: "icon_row_title",
          label: "Icon Row Title",
          required: false,
          locked: false,
          visibility: {
            controlling_field_path: "has_icon_row",
            controlling_value_regex: "true",
            operator: "EQUAL",
          },
          allow_new_line: false,
          display_width: null,
          type: "text",
        },
        {
          id: "lp-hero-icon-repeater",
          name: "icon_repeater",
          label: "Icons",
          required: false,
          locked: false,
          occurrence: { min: 1, max: 6, default: 1 },
          visibility: {
            controlling_field_path: "has_icon_row",
            controlling_value_regex: "true",
            operator: "EQUAL",
          },
          children: [
            {
              id: "lp-hero-icon-img",
              name: "icon",
              label: "Icon Image",
              required: false,
              locked: false,
              responsive: true,
              resizable: true,
              show_loading: false,
              display_width: null,
              type: "image",
              default: imageDefault(),
            },
            {
              id: "lp-hero-icon-text",
              name: "icon_text",
              label: "Icon Text",
              required: false,
              locked: false,
              allow_new_line: false,
              display_width: null,
              type: "text",
            },
          ],
          tab: "CONTENT",
          expanded: false,
          display_width: null,
          type: "group",
          default: [{ icon: imageDefault() }],
        },
      ];

    case "Text Image Module.module": {
      const section = (content.text_image_sections && content.text_image_sections[0]) || {
        headline: content.text_image_headline || "",
        body: content.text_image_body || "",
        image_url: content.text_image_url || "",
      };
      return [
        {
          id: "lp-ti-headline",
          name: "module_title",
          label: "Headline",
          required: false,
          locked: false,
          allow_new_line: false,
          display_width: null,
          type: "text",
          default: section.headline,
        },
        {
          id: "lp-ti-body",
          name: "module_text",
          label: "Body Text",
          required: false,
          locked: false,
          display_width: null,
          type: "richtext",
          default: section.body,
        },
        {
          id: "lp-ti-image",
          name: "module_image",
          label: "Image",
          required: false,
          locked: false,
          responsive: true,
          resizable: true,
          show_loading: false,
          display_width: null,
          type: "image",
          default: imageDefault(section.image_url, section.headline),
        },
        {
          id: "lp-ti-layout",
          name: "image_position",
          label: "Image position",
          required: false,
          locked: false,
          display_width: null,
          type: "choice",
          choices: [["left", "Image left"], ["right", "Image right"]],
          default: "right",
        },
      ];
    }

    case "About Module.module":
      return [
        {
          id: "lp-about-title",
          name: "module_title",
          label: "Headline",
          required: false,
          locked: false,
          allow_new_line: false,
          display_width: null,
          type: "text",
          default: content.about_headline || "",
        },
        {
          id: "lp-about-text",
          name: "module_text",
          label: "Body Text",
          required: false,
          locked: false,
          display_width: null,
          type: "richtext",
          default: content.about_body || "",
        },
        {
          id: "lp-about-image",
          name: "module_image",
          label: "Image",
          required: false,
          locked: false,
          responsive: true,
          resizable: true,
          show_loading: false,
          display_width: null,
          type: "image",
          default: imageDefault(content.about_image_url || "", content.about_headline || ""),
        },
        {
          id: "lp-about-cards",
          name: "cards",
          label: "Key Value Cards",
          required: false,
          locked: false,
          occurrence: { min: null, max: null, sorting_label_field: null, default: null },
          children: [
            {
              id: "lp-about-card-title",
              name: "card_title",
              label: "Card Title",
              required: false,
              locked: false,
              allow_new_line: false,
              display_width: null,
              type: "text",
            },
            {
              id: "lp-about-card-text",
              name: "card_text",
              label: "Card Text",
              required: false,
              locked: false,
              display_width: null,
              type: "richtext",
            },
          ],
          tab: "CONTENT",
          expanded: false,
          display_width: null,
          type: "group",
          default: [],
        },
      ];

    case "Testimonials Module.module": {
      const testimonialDefaults = (content.testimonials || []).map((t, i) => ({
        testimonial_logo: imageDefault(),
        testimonial_text: `<p>${t.quote}</p>`,
        author: t.author,
        company: t.company || "",
      }));

      return [
        {
          id: "lp-test-title",
          name: "module_title",
          label: "Section Title",
          required: false,
          locked: false,
          allow_new_line: false,
          display_width: null,
          type: "text",
          default: content.testimonials_headline || "What our clients say",
        },
        {
          id: "lp-test-items",
          name: "testimonial",
          label: "Testimonials",
          required: false,
          locked: false,
          occurrence: { min: 1, max: 3, sorting_label_field: null, default: null },
          children: [
            {
              id: "lp-test-logo",
              name: "testimonial_logo",
              label: "Company Logo",
              required: false,
              locked: false,
              responsive: true,
              resizable: true,
              show_loading: false,
              display_width: null,
              type: "image",
              default: imageDefault(),
            },
            {
              id: "lp-test-text",
              name: "testimonial_text",
              label: "Quote",
              required: false,
              locked: false,
              display_width: null,
              type: "richtext",
            },
            {
              id: "lp-test-author",
              name: "author",
              label: "Author Name",
              required: false,
              locked: false,
              allow_new_line: false,
              display_width: null,
              type: "text",
            },
            {
              id: "lp-test-company",
              name: "company",
              label: "Company / Role",
              required: false,
              locked: false,
              allow_new_line: false,
              display_width: null,
              type: "text",
            },
          ],
          tab: "CONTENT",
          expanded: false,
          display_width: null,
          type: "group",
          default: testimonialDefaults.length > 0 ? testimonialDefaults : [],
        },
      ];
    }

    case "CTA Module.module":
      return [
        {
          id: "lp-cta-text",
          name: "cta_text",
          label: "CTA Headline",
          required: false,
          locked: false,
          allow_new_line: false,
          display_width: null,
          type: "text",
          default: content.cta_headline || "",
        },
        {
          id: "lp-cta-button",
          name: "button_text",
          label: "Button Label",
          required: false,
          locked: false,
          allow_new_line: false,
          display_width: null,
          type: "text",
          default: content.cta_button_label || "Get in touch",
        },
      ];

    case "Footer Module.module":
      return [
        {
          id: "lp-footer-logo",
          name: "logo",
          label: "Logo",
          required: false,
          locked: false,
          responsive: true,
          resizable: true,
          show_loading: false,
          display_width: null,
          type: "image",
          default: imageDefault(brand.logo_url || "", brand.company_name),
        },
        {
          id: "lp-footer-copyright",
          name: "copyright_text",
          label: "Copyright Notice",
          required: false,
          locked: false,
          allow_new_line: false,
          display_width: null,
          type: "text",
          default: content.footer_copyright || `© ${new Date().getFullYear()} ${brand.company_name}. All rights reserved.`,
        },
      ];

    default:
      return [];
  }
}

// ─── New module field builders ────────────────────────────────────────────────

function buildCardGridFields(brand, section) {
  return [
    { id: "cg-title", name: "section_title", label: "Section Title", required: false, locked: false, allow_new_line: false, display_width: null, type: "text", default: section.title || "" },
    { id: "cg-columns", name: "columns", label: "Number of columns", required: false, locked: false, display_width: null, type: "choice", choices: [["2","2 columns"],["3","3 columns"],["4","4 columns"]], default: String(section.columns || 3) },
    { id: "cg-image-style", name: "image_style", label: "Image style", required: false, locked: false, display_width: null, type: "choice", choices: [["square","Square"],["rounded","Rounded corners"],["circle","Circle"]], default: section.image_style || "rounded" },
    { id: "cg-card-bg", name: "card_background", label: "Card background", required: false, locked: false, display_width: null, type: "choice", choices: [["none","None"],["light","Light"],["primary","Primary colour"],["accent","Accent colour"]], default: section.card_background || "none" },
    {
      id: "cg-cards", name: "cards", label: "Cards", required: false, locked: false,
      occurrence: { min: 1, max: 12, sorting_label_field: null, default: 3 },
      children: [
        { id: "cg-card-image", name: "image", label: "Image", required: false, locked: false, responsive: true, resizable: true, show_loading: false, display_width: null, type: "image", default: imageDefault() },
        { id: "cg-card-title", name: "card_title", label: "Card Title", required: false, locked: false, allow_new_line: false, display_width: null, type: "text", default: "" },
        { id: "cg-card-body", name: "card_text", label: "Card Body", required: false, locked: false, display_width: null, type: "richtext", default: "" },
        { id: "cg-card-link-label", name: "link_label", label: "Link Label", required: false, locked: false, allow_new_line: false, display_width: null, type: "text", default: "" },
      ],
      tab: "CONTENT", expanded: false, display_width: null, type: "group",
      default: (section.cards || []).map(c => ({
        image: imageDefault(c.image_url || "", c.title || ""),
        card_title: c.title || "",
        card_text: c.body || "",
        link_label: c.link_label || "",
      })),
    },
  ];
}

function buildFeatureGridFields(brand, section) {
  return [
    { id: "fg-title", name: "section_title", label: "Section Title", required: false, locked: false, allow_new_line: false, display_width: null, type: "text", default: section.title || "" },
    { id: "fg-intro", name: "section_intro", label: "Intro Text", required: false, locked: false, display_width: null, type: "richtext", default: section.intro || "" },
    { id: "fg-columns", name: "columns", label: "Columns", required: false, locked: false, display_width: null, type: "choice", choices: [["2","2 columns"],["3","3 columns"],["4","4 columns"]], default: String(section.columns || 3) },
    { id: "fg-icon-style", name: "icon_style", label: "Icon/image style", required: false, locked: false, display_width: null, type: "choice", choices: [["circle","Circle"],["rounded","Rounded"],["square","Square"],["icon-only","Icon only"]], default: section.icon_style || "circle" },
    {
      id: "fg-items", name: "items", label: "Features", required: false, locked: false,
      occurrence: { min: 1, max: 12, sorting_label_field: null, default: 3 },
      children: [
        { id: "fg-item-icon", name: "icon", label: "Icon or Image", required: false, locked: false, responsive: true, resizable: true, show_loading: false, display_width: null, type: "image", default: imageDefault() },
        { id: "fg-item-title", name: "item_title", label: "Title", required: false, locked: false, allow_new_line: false, display_width: null, type: "text", default: "" },
        { id: "fg-item-body", name: "item_text", label: "Description", required: false, locked: false, display_width: null, type: "richtext", default: "" },
      ],
      tab: "CONTENT", expanded: false, display_width: null, type: "group",
      default: (section.items || []).map(item => ({
        icon: imageDefault(item.icon_url || "", item.title || ""),
        item_title: item.title || "",
        item_text: item.body || "",
      })),
    },
  ];
}

function buildStatsFields(brand, section) {
  return [
    { id: "st-title", name: "section_title", label: "Section Title", required: false, locked: false, allow_new_line: false, display_width: null, type: "text", default: section.title || "" },
    { id: "st-background", name: "background", label: "Background", required: false, locked: false, display_width: null, type: "choice", choices: [["none","None"],["light","Light"],["primary","Primary colour"]], default: section.background || "primary" },
    {
      id: "st-stats", name: "stats", label: "Stats", required: false, locked: false,
      occurrence: { min: 2, max: 4, sorting_label_field: null, default: 3 },
      children: [
        { id: "st-stat-number", name: "number", label: "Number / Value", required: false, locked: false, allow_new_line: false, display_width: null, type: "text", default: "" },
        { id: "st-stat-label", name: "label", label: "Label", required: false, locked: false, allow_new_line: false, display_width: null, type: "text", default: "" },
        { id: "st-stat-suffix", name: "suffix", label: "Suffix", required: false, locked: false, allow_new_line: false, display_width: null, type: "text", default: "" },
      ],
      tab: "CONTENT", expanded: false, display_width: null, type: "group",
      default: (section.stats || []).map(s => ({ number: s.number || "", label: s.label || "", suffix: s.suffix || "" })),
    },
  ];
}

function buildFaqFields(brand, section) {
  return [
    { id: "faq-title", name: "section_title", label: "Section Title", required: false, locked: false, allow_new_line: false, display_width: null, type: "text", default: section.title || "Frequently asked questions" },
    {
      id: "faq-items", name: "items", label: "FAQ Items", required: false, locked: false,
      occurrence: { min: 1, max: 20, sorting_label_field: null, default: 4 },
      children: [
        { id: "faq-question", name: "question", label: "Question", required: false, locked: false, allow_new_line: false, display_width: null, type: "text", default: "" },
        { id: "faq-answer", name: "answer", label: "Answer", required: false, locked: false, display_width: null, type: "richtext", default: "" },
      ],
      tab: "CONTENT", expanded: false, display_width: null, type: "group",
      default: (section.items || []).map(i => ({ question: i.question || "", answer: i.answer || "" })),
    },
  ];
}

function buildLogoCarouselFields(brand, section) {
  return [
    { id: "lc-title", name: "section_title", label: "Section Title", required: false, locked: false, allow_new_line: false, display_width: null, type: "text", default: section.title || "" },
    {
      id: "lc-logos", name: "logos", label: "Logos", required: false, locked: false,
      occurrence: { min: 2, max: 20, sorting_label_field: null, default: 5 },
      children: [
        { id: "lc-logo-image", name: "image", label: "Logo Image", required: false, locked: false, responsive: true, resizable: true, show_loading: false, display_width: null, type: "image", default: imageDefault() },
        { id: "lc-logo-alt", name: "company_name", label: "Company Name", required: false, locked: false, allow_new_line: false, display_width: null, type: "text", default: "" },
      ],
      tab: "CONTENT", expanded: false, display_width: null, type: "group",
      default: (section.logos || []).map(l => ({
        image: imageDefault(l.image_url || "", l.name || ""),
        company_name: l.name || "",
      })),
    },
  ];
}

// ─── Dynamic base.html generation ────────────────────────────────────────────

function buildBaseHtml(brand, content, tokens) {
  const themeLabel = brand.theme_label;
  const googleFontsUrl = tokens["{{GOOGLE_FONTS_URL}}"];

  // Build module rows from manifest if present, else use legacy fixed structure
  let moduleRows = "";

  if (content.sections && content.sections.length > 0) {
    // Manifest-driven — track text-image index for alternating naming
    let tiIndex = 0;
    moduleRows = content.sections.map(section => {
      let modulePath;
      switch (section.type) {
        case "header":         modulePath = `/${themeLabel}/modules/Header Module.module`; break;
        case "hero":           modulePath = `/${themeLabel}/modules/Hero Form Module.module`; break;
        case "text-image":     modulePath = `/${themeLabel}/modules/${tiIndex === 0 ? "Text Image Module" : `Text Image Module ${tiIndex + 1}`}.module`; tiIndex++; break;
        case "about":          modulePath = `/${themeLabel}/modules/About Module.module`; break;
        case "card-grid":      modulePath = `/${themeLabel}/modules/Card Grid Module.module`; break;
        case "feature-grid":   modulePath = `/${themeLabel}/modules/Feature Grid Module.module`; break;
        case "stats":          modulePath = `/${themeLabel}/modules/Stats Module.module`; break;
        case "testimonials":   modulePath = `/${themeLabel}/modules/Testimonials Module.module`; break;
        case "faq":            modulePath = `/${themeLabel}/modules/FAQ Module.module`; break;
        case "logo-carousel":  modulePath = `/${themeLabel}/modules/Logo Carousel Module.module`; break;
        case "cta":            modulePath = `/${themeLabel}/modules/CTA Module.module`; break;
        case "footer":         modulePath = `/${themeLabel}/modules/Footer Module.module`; break;
        default: return "";
      }
      return `          {% dnd_row %}\n            {% dnd_module path="${modulePath}" %}{% end_dnd_module %}\n          {% end_dnd_row %}`;
    }).filter(Boolean).join("\n");
  } else {
    // Legacy fixed structure
    const sections = content.text_image_sections && content.text_image_sections.length > 0
      ? content.text_image_sections
      : [{ headline: content.text_image_headline || "", body: content.text_image_body || "", image_url: content.text_image_url || "" }];

    const textImageRows = sections.map((_, i) =>
      `          {% dnd_row %}\n            {% dnd_module path="/${themeLabel}/modules/${i === 0 ? "Text Image Module" : `Text Image Module ${i + 1}`}.module" %}{% end_dnd_module %}\n          {% end_dnd_row %}`
    ).join("\n");

    moduleRows = `          {% dnd_row %}
            {% dnd_module path="/${themeLabel}/modules/Header Module.module" %}{% end_dnd_module %}
          {% end_dnd_row %}
          {% dnd_row %}
            {% dnd_module path="/${themeLabel}/modules/Hero Form Module.module" %}{% end_dnd_module %}
          {% end_dnd_row %}
${textImageRows}
          {% dnd_row %}
            {% dnd_module path="/${themeLabel}/modules/About Module.module" %}{% end_dnd_module %}
          {% end_dnd_row %}
          {% dnd_row %}
            {% dnd_module path="/${themeLabel}/modules/Testimonials Module.module" %}{% end_dnd_module %}
          {% end_dnd_row %}
          {% dnd_row %}
            {% dnd_module path="/${themeLabel}/modules/CTA Module.module" %}{% end_dnd_module %}
          {% end_dnd_row %}
          {% dnd_row %}
            {% dnd_module path="/${themeLabel}/modules/Footer Module.module" %}{% end_dnd_module %}
          {% end_dnd_row %}`;
  }

  return `<!--
    templateType: page
    isAvailableForNewContent: true
-->
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    {% if content.html_title %}<title>{{ content.html_title }}</title>{% endif %}
    <meta name="description" content="{{ content.meta_description }}">
    {% if brand_settings.primaryFavicon.src %}
      <link rel="shortcut icon" href="{{ brand_settings.primaryFavicon.src }}" />
    {% endif %}
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="${googleFontsUrl}" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet" crossorigin="anonymous">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.13.1/font/bootstrap-icons.min.css" rel="stylesheet" crossorigin="anonymous">
    <link href="{{ get_asset_url('/${themeLabel}/assets/css/style.css') }}" rel="stylesheet">
    {{ standard_header_includes }}
    <script>
      document.addEventListener("DOMContentLoaded", function () {
        const scrollBtns = document.querySelectorAll(".js-scroll-to-form");
        const formEl = document.querySelector("#hs-form-wrapper");
        if (!scrollBtns.length || !formEl) return;
        scrollBtns.forEach(function(btn) {
          btn.addEventListener("click", function(e) {
            e.preventDefault();
            var offset = 100;
            var formTop = formEl.getBoundingClientRect().top + window.pageYOffset;
            window.scrollTo({ top: formTop - offset, behavior: "smooth" });
            setTimeout(function() {
              var firstField = formEl.querySelector("input, select, textarea");
              if (firstField) firstField.focus();
            }, 450);
          });
        });
      });
    </script>
  </head>
  <body class="{{ builtin_body_classes }}">

    {% dnd_area "main_dnd" class="my-dnd-area" label="Main Content" %}
      {% dnd_section %}
        {% dnd_column %}
${moduleRows}
        {% end_dnd_column %}
      {% end_dnd_section %}
    {% end_dnd_area %}

    {{ standard_footer_includes }}
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" crossorigin="anonymous"></script>
  </body>
</html>`;
}

const SKIP_FILES = new Set(["generate.js", ".DS_Store"]);

function processDir(srcDir, destDir, tokens, brand, content) {
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (SKIP_FILES.has(entry.name)) continue;

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      processDir(srcPath, destPath, tokens, brand, content);
    } else if (entry.name === "fields.json") {
      const moduleName = path.basename(srcDir);
      if (moduleName.endsWith(".module")) {
        const computed = buildModuleFields(moduleName, brand, content);
        fs.writeFileSync(destPath, JSON.stringify(computed, null, 2), "utf8");
      } else {
        fs.writeFileSync(destPath, fs.readFileSync(srcPath, "utf8"), "utf8");
      }
    } else if (entry.name === "base.html") {
      // Skip — written dynamically in generateTheme
    } else {
      const raw = fs.readFileSync(srcPath, "utf8");
      fs.writeFileSync(destPath, applyTokens(raw, tokens), "utf8");
    }
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function generateTheme(brand, content) {
  const tokens = buildTokenMap(brand);
  const outputPath = path.join(OUTPUT_DIR, brand.theme_label);

  if (fs.existsSync(outputPath)) {
    fs.rmSync(outputPath, { recursive: true, force: true });
  }

  processDir(__dirname, outputPath, tokens, brand, content);

  // Write dynamic base.html
  const templateDir = path.join(outputPath, "templates", "layout");
  fs.mkdirSync(templateDir, { recursive: true });
  fs.writeFileSync(path.join(templateDir, "base.html"), buildBaseHtml(brand, content, tokens), "utf8");

  // Handle manifest-driven extra modules
  if (content.sections && content.sections.length > 0) {
    const srcModuleDir = path.join(__dirname, "modules");

    let tiIndex = 0;
    for (const section of content.sections) {
      let destName = null;
      let fields = null;
      let srcName = null;

      switch (section.type) {
        case "text-image":
          if (tiIndex > 0) {
            destName = `Text Image Module ${tiIndex + 1}.module`;
            srcName = "Text Image Module.module";
            const sectionContent = { ...content, text_image_sections: [section] };
            fields = buildModuleFields("Text Image Module.module", brand, sectionContent);
            const posField = fields.find(f => f.name === "image_position");
            if (posField) posField.default = tiIndex % 2 === 0 ? "right" : "left";
          }
          tiIndex++;
          break;
        case "card-grid":
          destName = section.module_name || "Card Grid Module.module";
          srcName = "Card Grid Module.module";
          fields = buildCardGridFields(brand, section);
          break;
        case "feature-grid":
          destName = section.module_name || "Feature Grid Module.module";
          srcName = "Feature Grid Module.module";
          fields = buildFeatureGridFields(brand, section);
          break;
        case "stats":
          destName = section.module_name || "Stats Module.module";
          srcName = "Stats Module.module";
          fields = buildStatsFields(brand, section);
          break;
        case "faq":
          destName = section.module_name || "FAQ Module.module";
          srcName = "FAQ Module.module";
          fields = buildFaqFields(brand, section);
          break;
        case "logo-carousel":
          destName = section.module_name || "Logo Carousel Module.module";
          srcName = "Logo Carousel Module.module";
          fields = buildLogoCarouselFields(brand, section);
          break;
      }

      // Write extra module folder if needed (new type not in processDir output)
      if (destName && srcName && fields) {
        const destModuleDir = path.join(outputPath, "modules", destName);
        const srcModulePath = path.join(srcModuleDir, srcName);
        if (!fs.existsSync(destModuleDir)) {
          fs.mkdirSync(destModuleDir, { recursive: true });
          for (const file of ["meta.json", "module.html", "module.css"]) {
            const srcFile = path.join(srcModulePath, file);
            if (fs.existsSync(srcFile)) {
              fs.writeFileSync(path.join(destModuleDir, file), fs.readFileSync(srcFile, "utf8"), "utf8");
            }
          }
        }
        fs.writeFileSync(path.join(destModuleDir, "fields.json"), JSON.stringify(fields, null, 2), "utf8");
      }
    }
  } else {
    // Legacy: handle multiple text-image sections
    const sections = content.text_image_sections && content.text_image_sections.length > 0
      ? content.text_image_sections
      : [{ headline: content.text_image_headline || "", body: content.text_image_body || "", image_url: content.text_image_url || "" }];

    const srcModuleDir = path.join(__dirname, "modules", "Text Image Module.module");
    for (let i = 1; i < sections.length; i++) {
      const destModuleDir = path.join(outputPath, "modules", `Text Image Module ${i + 1}.module`);
      fs.mkdirSync(destModuleDir, { recursive: true });
      for (const file of ["meta.json", "module.html", "module.css"]) {
        const srcFile = path.join(srcModuleDir, file);
        if (fs.existsSync(srcFile)) {
          fs.writeFileSync(path.join(destModuleDir, file), fs.readFileSync(srcFile, "utf8"), "utf8");
        }
      }
      const sectionContent = { ...content, text_image_sections: [sections[i]] };
      const fields = buildModuleFields("Text Image Module.module", brand, sectionContent);
      const posField = fields.find(f => f.name === "image_position");
      if (posField) posField.default = i % 2 === 0 ? "right" : "left";
      fs.writeFileSync(path.join(destModuleDir, "fields.json"), JSON.stringify(fields, null, 2), "utf8");
    }
  }

  console.error(`[generate] Theme written to: ${outputPath}`);
  return outputPath;
}

// ─── Collect files for upload ─────────────────────────────────────────────────

export function collectFiles(themeDir, base = themeDir) {
  const files = [];
  for (const entry of fs.readdirSync(themeDir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const fullPath = path.join(themeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, base));
    } else {
      files.push({
        absolutePath: fullPath,
        relativePath: path.relative(base, fullPath),
      });
    }
  }
  return files;
}

// ─── CLI test ─────────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const testBrand = {
    company_name:    "Acme Corp",
    theme_label:     "Acme LP 2026",
    logo_url:        "",
    primary_color:   "#1A2E4A",
    secondary_color: "#C9DEEF",
    accent_color:    "#EF3E2D",
    font_heading:    "Montserrat",
    font_body:       "Open Sans",
    border_radius:   "8px",
  };

  const testContent = {
    form_id:               "test-form-id",
    hero_headline:         "Grow your business with Acme",
    hero_subheadline:      "The platform built for scale",
    hero_image_url:        "",
    text_image_headline:   "Why Acme?",
    text_image_body:       "<p>We help companies of all sizes achieve more.</p>",
    text_image_url:        "",
    about_headline:        "About us",
    about_body:            "<p>Founded in 2010, Acme has helped 1,000+ clients.</p>",
    about_image_url:       "",
    testimonials_headline: "What our clients say",
    cta_headline:          "Ready to get started?",
    cta_button_label:      "Talk to us",
    footer_copyright:      `© ${new Date().getFullYear()} Acme Corp. All rights reserved.`,
  };

  const outPath = generateTheme(testBrand, testContent);
  console.error("[generate] Files:", collectFiles(outPath).map(f => f.relativePath));
}
