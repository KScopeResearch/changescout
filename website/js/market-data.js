// Phase 2-3: shared MarketChange JSON loader.
// Used by mock-dashboard.html and opportunity-detail.html so both pages read
// Card1 / Opportunity Detail content from the same data source instead of
// each maintaining its own copy of the same text. Fails soft: any fetch or
// parse error returns null so callers can fall back to the existing static
// / JS-personalized content.

async function fetchMarketChanges() {
  try {
    const res = await fetch("data/market-changes.json");
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.market_changes) ? data.market_changes : null;
  } catch (e) {
    return null;
  }
}

function pickMarketChange(marketChanges, industry) {
  if (!marketChanges || !industry) return null;
  return (
    marketChanges.find(
      (mc) => Array.isArray(mc.target_industries) && mc.target_industries.includes(industry)
    ) || null
  );
}
