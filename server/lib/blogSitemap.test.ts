import { describe, it, expect } from "vitest";
import { buildBlogSitemap } from "./blogSitemap";

describe("buildBlogSitemap", () => {
  it("renders a valid empty sitemap when there are no articles", () => {
    const xml = buildBlogSitemap([], "https://leadmarket.app");
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("</urlset>");
    expect(xml).not.toContain("<url>");
  });

  it("emits one <url> block per article with absolute /blog/<slug> loc", () => {
    const xml = buildBlogSitemap(
      [
        { slug: "ma-rates-2026", publishedAt: "2026-01-15T00:00:00Z", updatedAt: null },
        { slug: "tcpa-changes-q2", publishedAt: "2026-04-01T00:00:00Z", updatedAt: null },
      ],
      "https://leadmarket.app",
    );
    expect(xml).toContain("<loc>https://leadmarket.app/blog/ma-rates-2026</loc>");
    expect(xml).toContain("<loc>https://leadmarket.app/blog/tcpa-changes-q2</loc>");
    expect(xml.match(/<url>/g)?.length).toBe(2);
  });

  it("prefers updatedAt over publishedAt for lastmod", () => {
    const xml = buildBlogSitemap(
      [
        {
          slug: "evergreen-post",
          publishedAt: "2026-01-15T00:00:00Z",
          updatedAt: "2026-05-30T00:00:00Z",
        },
      ],
      "https://leadmarket.app",
    );
    expect(xml).toContain("<lastmod>2026-05-30</lastmod>");
    expect(xml).not.toContain("<lastmod>2026-01-15</lastmod>");
  });

  it("falls back to publishedAt when updatedAt is null", () => {
    const xml = buildBlogSitemap(
      [{ slug: "post", publishedAt: "2026-03-01T12:34:56Z", updatedAt: null }],
      "https://leadmarket.app",
    );
    expect(xml).toContain("<lastmod>2026-03-01</lastmod>");
  });

  it("omits <lastmod> when both timestamps are null", () => {
    const xml = buildBlogSitemap(
      [{ slug: "draft", publishedAt: null, updatedAt: null }],
      "https://leadmarket.app",
    );
    expect(xml).toContain("<loc>https://leadmarket.app/blog/draft</loc>");
    expect(xml).not.toContain("<lastmod>");
  });

  it("strips a trailing slash on the base URL so locs aren't double-slashed", () => {
    const xml = buildBlogSitemap(
      [{ slug: "post", publishedAt: null, updatedAt: null }],
      "https://leadmarket.app/",
    );
    expect(xml).toContain("<loc>https://leadmarket.app/blog/post</loc>");
    expect(xml).not.toContain("//blog/");
  });

  it("XML-escapes ampersands and angle brackets in slugs", () => {
    // Defensive: slugs SHOULD be slugified upstream, but if a malformed
    // slug ever slips through the sitemap must remain valid XML.
    const xml = buildBlogSitemap(
      [{ slug: "rates&changes<2027>", publishedAt: null, updatedAt: null }],
      "https://leadmarket.app",
    );
    expect(xml).toContain("rates&amp;changes&lt;2027&gt;");
    expect(xml).not.toMatch(/rates&changes/);
  });

  it("XML-escapes quotes and apostrophes too", () => {
    // <loc> is element text so " and ' aren't strictly required there,
    // but escapeXml is shared and might be reused in attribute values
    // (sitemap-news, image:caption) later. The helper escapes all five
    // XML entities to stay safe for that use.
    const xml = buildBlogSitemap(
      [{ slug: `it's "fast"`, publishedAt: null, updatedAt: null }],
      "https://leadmarket.app",
    );
    expect(xml).toContain("it&apos;s &quot;fast&quot;");
  });

  it("doesn't crash or emit malformed XML when given a bare-slash base URL", () => {
    // A misconfigured APP_URL like "/" or "///" is a deploy-config
    // problem (check:predeploy should catch it). When it does slip
    // through, we still emit syntactically valid XML — just with a
    // relative <loc> path that Search Console will reject. Better
    // than silently producing a wrong absolute URL.
    const xml = buildBlogSitemap(
      [{ slug: "post", publishedAt: null, updatedAt: null }],
      "///",
    );
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<url>");
    expect(xml).toContain("/blog/post");
  });
});
