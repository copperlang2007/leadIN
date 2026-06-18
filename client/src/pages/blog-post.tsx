import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Tag,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";
import { format } from "date-fns";
import { marked } from "marked";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

interface Article {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  category: string;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
}

const CATEGORY_COLORS: Record<string, string> = {
  "Medicare Advantage": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Medicare Supplement": "bg-violet-500/10 text-violet-400 border-violet-500/20",
  "Final Expense": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "Industry News": "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

function estimateReadingTime(text: string): number {
  return Math.max(1, Math.ceil(text.split(/\s+/).length / 200));
}

function ArticleBodySkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className={`h-4 bg-slate-700 ${i % 3 === 2 ? "w-3/4" : "w-full"}`} />
      ))}
    </div>
  );
}

interface BlogPostProps {
  params: { slug: string };
}

export default function BlogPost({ params }: BlogPostProps) {
  const { slug } = params;

  const { data: article, isLoading, isError } = useQuery<Article>({
    queryKey: ["/api/content", slug],
    queryFn: async () => {
      const res = await fetch(`/api/content/${slug}`);
      if (!res.ok) throw new Error("Article not found");
      return res.json();
    },
  });

  const renderedBody = article ? marked(article.body) as string : "";
  const readTime = article ? estimateReadingTime(article.body) : 0;

  useDocumentTitle(article?.seoTitle ?? article?.title ?? "Article");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Public header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <div className="h-7 w-7 rounded-lg bg-emerald-500 flex items-center justify-center">
                <ShieldCheck className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-white text-lg">LeadMarket</span>
            </div>
          </Link>
          <Link href="/blog">
            <span className="text-sm text-slate-400 hover:text-white transition-colors">
              ← All Articles
            </span>
          </Link>
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Back nav */}
          <div className="mb-8">
            <Link href="/blog">
              <Button
                variant="ghost"
                size="sm"
                data-testid="blog-back-button"
                className="text-slate-400 hover:text-white -ml-2"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Blog
              </Button>
            </Link>
          </div>

          {/* Error state */}
          {isError && (
            <div
              data-testid="blog-post-error"
              className="text-center py-20 text-slate-500"
            >
              <AlertCircle className="h-10 w-10 mx-auto mb-4 opacity-40" />
              <p className="text-lg font-medium text-slate-400">
                Article not found
              </p>
              <p className="text-sm mt-1">
                This article may have been removed or the URL is incorrect.
              </p>
              <Link href="/blog">
                <Button className="mt-6 bg-emerald-500 hover:bg-emerald-600 text-white">
                  Browse All Articles
                </Button>
              </Link>
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div data-testid="blog-post-loading">
              <Skeleton className="h-6 w-24 mb-4 bg-slate-700" />
              <Skeleton className="h-10 w-full mb-2 bg-slate-700" />
              <Skeleton className="h-10 w-2/3 mb-6 bg-slate-700" />
              <Skeleton className="h-4 w-full mb-8 bg-slate-700" />
              <ArticleBodySkeleton />
            </div>
          )}

          {/* Article */}
          {!isLoading && !isError && article && (
            <article data-testid="blog-post-article">
              {/* Category badge */}
              <div className="flex flex-wrap items-center gap-3 mb-5">
                <Badge
                  className={`text-xs border ${CATEGORY_COLORS[article.category] ?? "bg-slate-700 text-slate-300"}`}
                >
                  {article.category}
                </Badge>
                {article.publishedAt && (
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(article.publishedAt), "MMMM d, yyyy")}
                  </span>
                )}
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {readTime} min read
                </span>
              </div>

              {/* Title */}
              <h1
                data-testid="blog-post-title"
                className="text-3xl font-bold text-white font-heading mb-4 leading-tight"
              >
                {article.title}
              </h1>

              {/* Excerpt */}
              <p className="text-slate-300 text-lg leading-relaxed mb-8 border-l-2 border-emerald-500 pl-4">
                {article.excerpt}
              </p>

              {/* Divider */}
              <div className="h-px bg-slate-700 mb-8" />

              {/* Article body rendered from markdown */}
              <div
                data-testid="blog-post-body"
                className="prose prose-invert prose-slate prose-emerald max-w-none
                  prose-headings:font-heading prose-headings:text-white
                  prose-h2:text-xl prose-h2:font-semibold prose-h2:mt-8 prose-h2:mb-3
                  prose-h3:text-lg prose-h3:font-medium prose-h3:mt-6 prose-h3:mb-2
                  prose-p:text-slate-300 prose-p:leading-relaxed
                  prose-li:text-slate-300
                  prose-strong:text-white prose-strong:font-semibold
                  prose-a:text-emerald-400 hover:prose-a:text-emerald-300
                  prose-table:text-sm prose-table:border-collapse
                  prose-th:bg-slate-700 prose-th:text-white prose-th:p-2 prose-th:border prose-th:border-slate-600
                  prose-td:text-slate-300 prose-td:p-2 prose-td:border prose-td:border-slate-700
                  prose-code:text-emerald-400 prose-code:bg-slate-800 prose-code:rounded prose-code:px-1
                  prose-blockquote:border-emerald-500 prose-blockquote:text-slate-400"
                dangerouslySetInnerHTML={{ __html: renderedBody }}
              />

              {/* Tags */}
              {article.tags && article.tags.length > 0 && (
                <div className="mt-10 pt-6 border-t border-slate-700">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag className="h-4 w-4 text-slate-500" />
                    {article.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="text-xs text-slate-400 border-slate-600 hover:border-slate-500"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* CTA */}
              <div className="mt-10 p-6 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                <h3 className="text-white font-semibold mb-2">
                  Ready to find verified leads in your state?
                </h3>
                <p className="text-slate-400 text-sm mb-4">
                  Browse Medicare Advantage, Medicare Supplement, and Final
                  Expense leads with Triple-Layer verification and compatibility
                  matching.
                </p>
                <Link href="/">
                  <Button className="bg-emerald-500 hover:bg-emerald-600 text-white">
                    Browse LeadMarket
                  </Button>
                </Link>
              </div>
            </article>
          )}
      </div>
    </div>
  );
}
