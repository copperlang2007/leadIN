// Build a blog sitemap XML document from a list of published articles.
//
// Extracted so the body-shape is unit-testable without spinning up
// Express + DB. The route handler in routes.ts is a thin wrapper that
// fetches the articles and calls buildBlogSitemap().

export interface SitemapArticle {
  slug: string;
  publishedAt: Date | string | null;
  updatedAt: Date | string | null;
}

function escapeXml(s: string): string {
  // Escape all five XML predefined entities. The <loc> we emit lives
  // in element text content where & and < are mandatory, but we also
  // escape >, ", and ' so this helper is safe to reuse for attribute
  // values in future call sites (sitemap-news image:caption etc.).
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function trimTrailingSlash(s: string): string {
  // A base URL that's nothing but slashes (e.g. "/", "///") collapses
  // to "" here, which makes <loc> values relative like "/blog/slug".
  // That violates the sitemaps spec, which requires absolute URLs.
  // Rather than silently emit a wrong-looking absolute URL, we let
  // the relative path fall through — Google Search Console will
  // flag the sitemap as invalid, and the deploy env validator
  // (check:predeploy) should be the layer that prevents a bare-"/"
  // APP_URL from reaching here in the first place.
  return s.replace(/\/+$/, "");
}

function dateOnly(d: Date | string | null): string | null {
  if (!d) return null;
  const ts = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(ts.getTime())) return null;
  return ts.toISOString().slice(0, 10);
}

export function buildBlogSitemap(articles: SitemapArticle[], baseUrl: string): string {
  const base = trimTrailingSlash(baseUrl);
  const urls = articles
    .map((a) => {
      const lastmod = dateOnly(a.updatedAt ?? a.publishedAt);
      const lines = [
        "  <url>",
        `    <loc>${escapeXml(`${base}/blog/${a.slug}`)}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
        "    <changefreq>monthly</changefreq>",
        "    <priority>0.4</priority>",
        "  </url>",
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}
