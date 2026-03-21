import cron from "node-cron";
import { storage } from "./storage";

const ARTICLE_TOPICS = [
  {
    title: "Medicare Advantage vs. Original Medicare: Which Is Right for You?",
    category: "Medicare Advantage",
    tags: ["Medicare Advantage", "Original Medicare", "comparison", "guide"],
    excerpt:
      "Understanding the key differences between Medicare Advantage and Original Medicare can save seniors thousands of dollars annually. Here's what you need to know before making a decision.",
  },
  {
    title: "The Complete Guide to Medicare Supplement Plans in 2025",
    category: "Medicare Supplement",
    tags: ["Medicare Supplement", "Medigap", "2025", "guide"],
    excerpt:
      "Medicare Supplement (Medigap) plans fill the coverage gaps left by Original Medicare. Learn which plan letters offer the best value and how to compare carrier pricing.",
  },
  {
    title: "Final Expense Insurance: Protecting Your Family from Unexpected Costs",
    category: "Final Expense",
    tags: ["Final Expense", "burial insurance", "life insurance", "seniors"],
    excerpt:
      "Final expense insurance is a straightforward way to ensure your loved ones aren't burdened with end-of-life costs. Discover who qualifies and what coverage amounts make sense.",
  },
  {
    title: "Understanding Medicare Part D: Prescription Drug Coverage Explained",
    category: "Medicare Advantage",
    tags: ["Medicare Part D", "prescription drugs", "coverage", "formulary"],
    excerpt:
      "Prescription drug coverage under Medicare Part D can be confusing. This guide breaks down formularies, the coverage gap, and how to choose the right plan for your medications.",
  },
  {
    title: "5 Mistakes Agents Make When Selling Medicare Leads",
    category: "Industry News",
    tags: ["lead buying", "agent tips", "Medicare", "sales"],
    excerpt:
      "Experienced insurance agents know that lead quality matters as much as lead quantity. Avoid these five common mistakes to maximize your conversion rate and ROI.",
  },
  {
    title: "How to Read Lead Provenance Data: A Buyer's Guide",
    category: "Industry News",
    tags: ["lead provenance", "TCPA", "compliance", "lead quality"],
    excerpt:
      "Lead provenance tracking tells you exactly how and when a consumer consented to be contacted. Understanding this data is essential for TCPA compliance and conversion success.",
  },
  {
    title: "Medicare Supplement Plan G vs Plan N: 2025 Comparison",
    category: "Medicare Supplement",
    tags: ["Plan G", "Plan N", "Medigap", "comparison", "2025"],
    excerpt:
      "Plan G and Plan N are the two most popular Medigap options for new Medicare enrollees. We break down the cost differences, coverage gaps, and which seniors each plan suits best.",
  },
  {
    title: "What Is Exclusive vs. Shared Lead Exclusivity?",
    category: "Industry News",
    tags: ["exclusive leads", "shared leads", "lead types", "ROI"],
    excerpt:
      "When purchasing insurance leads, exclusivity is one of the most important factors. Learn the difference between exclusive, shared, and aged leads and how each affects your close rate.",
  },
  {
    title: "Final Expense Lead Generation: Top Sources Ranked",
    category: "Final Expense",
    tags: ["Final Expense", "lead generation", "Facebook", "direct mail", "organic"],
    excerpt:
      "Not all lead sources are created equal for final expense insurance. We analyze Facebook, direct mail, call center transfers, and organic search leads by conversion rate and cost.",
  },
  {
    title: "TCPA Compliance for Insurance Agents: What You Must Know",
    category: "Industry News",
    tags: ["TCPA", "compliance", "consent", "regulations", "FCC"],
    excerpt:
      "The Telephone Consumer Protection Act imposes strict rules on how agents can contact insurance leads. Non-compliance can result in fines of up to $1,500 per call. Here's how to stay compliant.",
  },
];

const ARTICLE_BODIES: Record<string, string> = {
  "Medicare Advantage vs. Original Medicare: Which Is Right for You?": `
## What Is Medicare Advantage?

Medicare Advantage (also called Medicare Part C) is an all-in-one alternative to Original Medicare offered by private insurance companies approved by Medicare. These plans bundle Part A (hospital coverage), Part B (medical coverage), and usually Part D (prescription drugs) into a single plan.

## What Is Original Medicare?

Original Medicare is the federal health insurance program consisting of:
- **Part A**: Hospital insurance covering inpatient care, skilled nursing, and some home health services
- **Part B**: Medical insurance covering doctor visits, outpatient care, and preventive services

## Key Differences

| Feature | Medicare Advantage | Original Medicare |
|---------|-------------------|------------------|
| Monthly premium | Often $0 (beyond Part B) | Part B premium required |
| Network | Typically HMO/PPO network | Any provider accepting Medicare |
| Out-of-pocket maximum | Yes (capped) | No cap |
| Extra benefits | Vision, dental, fitness | Not covered |
| Drug coverage | Usually included | Requires separate Part D |

## Who Benefits Most from Medicare Advantage?

Medicare Advantage tends to work best for seniors who:
- Live in an area with a strong provider network
- Want predictable costs with an out-of-pocket maximum
- Value extra benefits like dental or vision coverage
- Take a limited number of prescription medications

## Who Benefits Most from Original Medicare?

Original Medicare may be the better choice for seniors who:
- Travel frequently or live in multiple states
- Have complex health conditions requiring specialist care
- Prefer maximum provider flexibility
- Can afford a Medicare Supplement to cover gaps

## The Bottom Line

There's no universally "better" choice — the right plan depends on your health, finances, and where you live. Consulting with a licensed insurance agent who can compare local Medicare Advantage plans against Medigap costs is the most reliable way to make the right decision.
  `,
  "The Complete Guide to Medicare Supplement Plans in 2025": `
## What Is a Medicare Supplement Plan?

Medicare Supplement insurance (Medigap) is private health insurance designed to cover the "gaps" in Original Medicare — things like deductibles, copayments, and coinsurance that Medicare doesn't fully pay.

## Standardized Plan Letters

Medigap plans are standardized by the federal government and sold under lettered plans (A, B, D, G, K, L, M, N). Each letter represents a specific set of benefits, meaning a Plan G from one carrier offers the same core benefits as Plan G from any other carrier — though premiums can vary significantly.

## The Most Popular Plans in 2025

**Plan G** is now the most comprehensive plan available to new Medicare enrollees (Plan F was discontinued for new enrollees in 2020). Plan G covers:
- Part A coinsurance and hospital costs
- Part B coinsurance or copayment
- Part A hospice care coinsurance
- Skilled nursing facility coinsurance
- Part A deductible
- Foreign travel emergency (up to plan limits)

The only gap: the Part B annual deductible ($240 in 2025).

**Plan N** offers similar coverage to Plan G at a lower premium, with two key trade-offs:
- Up to $20 copay for office visits
- Up to $50 copay for ER visits (waived if admitted)

## How to Compare Carriers

Since benefits are standardized, comparing Medigap comes down to:
1. **Premium cost** — can vary by 40–80% for identical coverage
2. **Rate increase history** — some carriers raise rates aggressively after year one
3. **Financial stability** — look for A-rated carriers
4. **Household discounts** — many carriers offer 5–7% discounts for couples

## When to Buy

The best time to purchase a Medigap policy is during your **Open Enrollment Period** — the 6-month window starting the month you turn 65 and enroll in Part B. During this window, insurers cannot deny coverage or charge higher premiums based on health conditions.

## Working with a Broker

An independent Medicare insurance broker can compare dozens of carriers simultaneously at no cost to you. They're compensated by the insurers, so their services are free to beneficiaries.
  `,
};

function generateArticleBody(title: string, category: string, tags: string[]): string {
  if (ARTICLE_BODIES[title]) {
    return ARTICLE_BODIES[title].trim();
  }

  const tagStr = tags.slice(0, 3).join(", ");
  return `
## Overview

This article covers essential information about ${category} insurance, with a focus on ${tagStr}. Whether you're a Medicare beneficiary exploring your options or an insurance professional looking to better serve your clients, this guide provides actionable insights.

## Why ${category} Matters

${category} insurance plays a critical role in protecting seniors from unexpected healthcare and financial costs. Understanding the nuances of coverage options, eligibility requirements, and cost structures can make a significant difference in long-term financial security.

## Key Considerations

When evaluating ${category} options, there are several factors to keep in mind:

- **Coverage scope**: What is and isn't covered under the plan
- **Network restrictions**: Whether you can see your current doctors and specialists
- **Cost structure**: Premiums, deductibles, copayments, and out-of-pocket maximums
- **Enrollment timing**: Open enrollment periods and special enrollment triggers
- **Geographic availability**: Plan availability varies significantly by zip code

## Common Questions

**Who is eligible?**
Eligibility depends on age, Medicare enrollment status, and in some cases health history. Most ${category} products are available to seniors aged 65 and older who are enrolled in Medicare Parts A and B.

**When is the best time to enroll?**
Enrolling during your initial eligibility window ensures guaranteed-issue rights in most states, meaning insurers cannot deny coverage or charge higher premiums based on pre-existing conditions.

**How do I compare my options?**
Working with a licensed, independent insurance agent who specializes in senior markets is the most efficient way to compare options. They can access quotes from dozens of carriers simultaneously and explain the trade-offs of each plan.

## Next Steps

Ready to explore your ${category} options? Browse verified leads in your state on the LeadMarket marketplace, or consult with one of our licensed agents to discuss coverage tailored to your needs.

*This article is for educational purposes. Always consult with a licensed insurance professional before making coverage decisions.*
  `.trim();
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function generateAndPublishArticle(): Promise<void> {
  const allArticles = await storage.getContentArticles(false);
  const existingSlugs = new Set(allArticles.map((a) => a.slug));

  const available = ARTICLE_TOPICS.filter(
    (t) => !existingSlugs.has(slugify(t.title))
  );

  if (available.length === 0) {
    console.log("[content-engine] All topics already published.");
    return;
  }

  const topic = available[Math.floor(Math.random() * available.length)];
  const slug = slugify(topic.title);
  const body = generateArticleBody(topic.title, topic.category, topic.tags);
  const now = new Date();

  await storage.createContentArticle({
    slug,
    title: topic.title,
    excerpt: topic.excerpt,
    body,
    category: topic.category,
    tags: topic.tags,
    seoTitle: `${topic.title} | LeadMarket`,
    seoDescription: topic.excerpt,
    published: true,
    publishedAt: now,
  });

  console.log(`[content-engine] Published article: "${topic.title}" (${slug})`);

  await pingSitemapToGoogle();
}

async function pingSitemapToGoogle(): Promise<void> {
  try {
    const sitemapUrl = process.env.APP_URL
      ? `${process.env.APP_URL}/sitemap.xml`
      : null;
    if (!sitemapUrl) return;

    const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
    const res = await fetch(pingUrl);
    console.log(`[content-engine] Google sitemap ping: ${res.status}`);
  } catch (err) {
    console.warn("[content-engine] Google sitemap ping failed:", err);
  }
}

export function startContentEngine(): void {
  cron.schedule("0 9 * * *", async () => {
    console.log("[content-engine] Daily cron triggered.");
    try {
      await generateAndPublishArticle();
    } catch (err) {
      console.error("[content-engine] Cron error:", err);
    }
  });
  console.log("[content-engine] Scheduled daily article generation at 09:00.");
}

export { generateAndPublishArticle, slugify };
