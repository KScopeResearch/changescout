// Phase 2-3: shared MarketChange JSON loader.
// Used by mock-dashboard.html and opportunity-detail.html so both pages read
// Card1 / Opportunity Detail content from the same data source instead of
// each maintaining its own copy of the same text. Fails soft: any fetch or
// parse error returns null so callers can fall back to the existing static
// / JS-personalized content.

async function fetchMarketChanges() {
  try {
    // no-store: this file is updated frequently during the beta and GitHub
    // Pages doesn't send strong cache-busting headers, so a returning
    // tester's browser can silently keep serving stale content otherwise
    // (observed firsthand during Phase 3 pre-review testing).
    const res = await fetch("data/market-changes.json", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.market_changes) ? data.market_changes : null;
  } catch (e) {
    return null;
  }
}

// index selects which of the industry's matching entries to return (in
// array order): 0 = Card1/topic1 (default), 1 = Card2/topic2, 2 = Card3/topic3.
function pickMarketChange(marketChanges, industry, index = 0) {
  if (!marketChanges || !industry) return null;
  const matches = marketChanges.filter(
    (mc) => Array.isArray(mc.target_industries) && mc.target_industries.includes(industry)
  );
  return matches[index] || null;
}
