## Diagnosis: why the app feels slow

I traced the lag to **client-side data fetching defaults**, not the backend. Concrete issues:

1. **QueryClient has no defaults.** `src/router.tsx` creates `new QueryClient()` with zero config. React Query defaults to `staleTime: 0` + refetch on window focus + refetch on mount, so every tab switch and every route re-mount re-runs every query.
2. **Many parallel `useQuery` per page, no loaders.**
   - Operations: 4 queries on the leaderboard + 4 more in the detail sheet + 4 in the Teams tab.
   - Financial: 3+ queries per tab, plus a recompute mutation that invalidates everything.
   - Pipeline (801 lines): 2 top-level queries plus nested ones.
   - None use route loaders / `ensureQueryData`, so the page renders empty, then each query waterfalls in.
3. **Duplicate query keys across routes.** `["employees"]`, `["teams"]`, `["kpis"]` are fetched independently from multiple components — each mount triggers its own request because nothing is shared/cached long enough.
4. **`defaultPreloadStaleTime: 0`** combined with no `staleTime` means hover-preloads re-fetch immediately on real navigation.
5. **VoiceAssistant always mounted** on every authenticated screen. It's ~284 lines, pulls `useRouter` + `useQueryClient` + speech APIs, and runs `speechSynthesis.getVoices()` etc. on every mount.
6. **No code-splitting hints for big route files** (financial 549, operations 553, pipeline 801) — TanStack does route-level splitting, but the heavy detail sheets inside them ship in the same chunk.

## Plan to fix (frontend only, no schema/business-logic changes)

### 1. Tune the global QueryClient (biggest win, smallest change)

`src/router.tsx`:
```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,            // 1 min: stop refetching on every mount
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,  // kill background refetch storms
      refetchOnMount: false,
      retry: 1,
    },
  },
});
```
Also set router `defaultPreloadStaleTime: 30_000` so hover-preloaded data is reused on the real click.

Expected effect: tab switches and route changes become near-instant because cached data is reused; tables that were re-fetching on every navigation stop doing so.

### 2. Lazy-load the VoiceAssistant

Replace the static import in `src/components/app-shell.tsx` with `React.lazy` + `Suspense`, and only mount it after `requestIdleCallback` / first interaction. This removes ~10-20kb + speech API setup from the initial render of every authenticated page.

### 3. Share heavy queries via route loaders (HR shell only)

Add a small loader on `src/routes/_authenticated/route.tsx` that primes the most-used shared queries with `ensureQueryData`:
- `["employees"]`, `["teams"]`, `["kpis"]` (used by dashboard, operations, financial).

After step 1, this gives a single fetch reused across HR tabs instead of one fetch per tab on first visit.

### 4. Reduce `select("*")` in two hot spots

- `employee_kpis` → fetch only `employee_id, period_month, kpi, productivity, quality, attendance_pct, bonus_pct, base_salary_mmk` (current `select("*")` pulls every column).
- `payroll_lines` in financial → narrow to the columns actually rendered.

This trims response sizes; on a slow connection it shaves hundreds of ms.

### 5. Drop unused invalidations

`promoteEmployee` and `runPayroll` invalidate `["employees", "kpis", "promotions", "payroll_runs", "payroll_lines"]` even when the user is not on those tabs. Move to targeted invalidation by passing `refetchType: "active"` so only mounted queries refetch.

### Out of scope
- No DB migrations, no RPC changes, no UI redesign.
- No Cloud instance upgrade — current symptoms are client-cache misconfig, not backend overload. We can revisit instance size only if step 1+2 don't resolve it.

### Files touched
- `src/router.tsx` — QueryClient defaults + router preload stale time.
- `src/components/app-shell.tsx` — lazy VoiceAssistant.
- `src/routes/_authenticated/route.tsx` — shared loader priming.
- `src/routes/_authenticated/operations.tsx`, `financial.tsx` — narrower `select` + targeted invalidation.

### Validation
After changes: navigate Dashboard → Operations → Financial → back. Network panel should show each shared query firing once, not on every tab switch.
