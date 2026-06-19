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
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function trimTrailingSlash(s: string): string {
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
