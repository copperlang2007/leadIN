import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// CSRF: the server issues a non-HttpOnly `lm_csrf` cookie. The SPA reads it
// and echoes it via `X-CSRF-Token` on every state-changing request so the
// server's double-submit check succeeds.
function getCsrfToken(): string | undefined {
  const m = document.cookie.match(/(?:^|;\s*)lm_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

function buildHeaders(hasJsonBody: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (hasJsonBody) h["Content-Type"] = "application/json";
  const token = getCsrfToken();
  if (token) h["X-CSRF-Token"] = token;
  return h;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: buildHeaders(!!data),
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// Invalidate every cached query whose key starts with `prefix`. Query keys in
// this app are URL strings (often with query params baked in, e.g.
// `/api/leads?minPrice=0`), so exact-key invalidation misses them — this is
// the one blessed way to say "refresh everything under /api/leads".
export function invalidatePrefix(prefix: string): void {
  queryClient.invalidateQueries({
    predicate: (q) =>
      typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith(prefix),
  });
}
