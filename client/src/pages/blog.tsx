import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Calendar, ChevronRight, Rss, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { EmptyState } from "@/components/empty-state";

interface Article {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  tags: string[];
  publishedAt: string | null;
}

const CATEGORY_COLORS: Record<string, string> = {
  "Medicare Advantage": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Medicare Supplement": "bg-violet-500/10 text-violet-400 border-violet-500/20",
  "Final Expense": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "Industry News": "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

function ArticleSkeleton() {
  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardContent className="p-6">
        <Skeleton className="h-4 w-24 mb-3 bg-slate-700" />
        <Skeleton className="h-6 w-3/4 mb-2 bg-slate-700" />
        <Skeleton className="h-4 w-full mb-1 bg-slate-700" />
        <Skeleton className="h-4 w-5/6 mb-4 bg-slate-700" />
        <Skeleton className="h-4 w-20 bg-slate-700" />
      </CardContent>
    </Card>
  );
}

export default function Blog() {
  const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: ["/api/content"],
    queryFn: async () => {
      const res = await fetch("/api/content");
      if (!res.ok) throw new Error("Failed to fetch articles");
      return res.json();
    },
  });

  const grouped = articles.reduce<Record<string, Article[]>>((acc, a) => {
    if (!acc[a.category]) acc[a.category] = [];
    acc[a.category].push(a);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Public header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <div className="h-7 w-7 rounded-lg bg-emerald-500 flex items-center justify-center">
                <ShieldCheck className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-white text-lg">LeadMarket</span>
            </div>
          </Link>
          <Link href="/">
            <span className="text-sm text-slate-400 hover:text-white transition-colors">
              Browse Leads →
            </span>
          </Link>
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Header */}
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                <BookOpen className="h-5 w-5 text-emerald-400" />
              </div>
              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border">
                LeadMarket Intelligence
              </Badge>
            </div>
            <h1
              data-testid="blog-title"
              className="text-3xl font-bold text-white font-heading mb-2"
            >
              Insurance Industry Insights
            </h1>
            <p className="text-slate-400 max-w-2xl">
              Expert guides on Medicare Advantage, Medicare Supplement, and Final
              Expense insurance — written for agents and consumers alike.
            </p>
          </div>

          {/* Empty state */}
          {!isLoading && articles.length === 0 && (
            <EmptyState
              icon={Rss}
              title="No articles yet"
              description="The content engine publishes new posts as it pulls in industry signals. Check back shortly — or follow us on social for instant notifications."
              data-testid="blog-empty"
            />
          )}

          {/* Loading skeletons */}
          {isLoading && (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <ArticleSkeleton key={i} />
              ))}
            </div>
          )}

          {/* Article grid */}
          {!isLoading && articles.length > 0 && (
            <div className="space-y-10">
              {Object.entries(grouped).map(([category, categoryArticles]) => (
                <section key={category} data-testid={`blog-category-${category}`}>
                  <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                      {category}
                    </h2>
                    <div className="flex-1 h-px bg-slate-700" />
                    <span className="text-xs text-slate-600">
                      {categoryArticles.length} article
                      {categoryArticles.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {categoryArticles.map((article) => (
                      <Link key={article.id} href={`/blog/${article.slug}`}>
                        <Card
                          data-testid={`blog-card-${article.id}`}
                          className="bg-slate-800/50 border-slate-700 hover:border-slate-500 hover:bg-slate-800 transition-all cursor-pointer group h-full"
                        >
                          <CardContent className="p-6 flex flex-col h-full">
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <Badge
                                className={`text-xs border ${CATEGORY_COLORS[article.category] ?? "bg-slate-700 text-slate-300"}`}
                              >
                                {article.category}
                              </Badge>
                              {article.publishedAt && (
                                <span className="text-xs text-slate-500 flex items-center gap-1 shrink-0">
                                  <Calendar className="h-3 w-3" />
                                  {format(
                                    new Date(article.publishedAt),
                                    "MMM d, yyyy"
                                  )}
                                </span>
                              )}
                            </div>
                            <h3 className="text-white font-semibold mb-2 group-hover:text-emerald-400 transition-colors leading-snug">
                              {article.title}
                            </h3>
                            <p className="text-slate-400 text-sm leading-relaxed flex-1">
                              {article.excerpt}
                            </p>
                            <div className="mt-4 flex items-center gap-1 text-emerald-400 text-sm font-medium">
                              Read article
                              <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
