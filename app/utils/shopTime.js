// app/utils/shopTime.js
export async function computeShopDiscountWindow(admin, cfg) {
  // 1) fetch shop timezone + offset (minutes from UTC)
  const resp = await admin.graphql(`
    query {
      shop {
        ianaTimezone
        timezoneOffsetMinutes
      }
    }
  `);
  const { data } = await resp.json();
  const tz = data?.shop?.ianaTimezone || "UTC";
  const offsetMin = Number(data?.shop?.timezoneOffsetMinutes ?? 0);

  // 2) "now" in UTC, then derive the shop *wall clock* "now"
  const nowUtc = new Date();
  const startLocalMs = nowUtc.getTime() + offsetMin * 60 * 1000;

  // 3) parse a natural-language-ish duration from cfg.duration
  //    Supported: minutes, hours, days, weeks, months (months≈30d)
  const durMs = parseDurationMs(cfg?.duration);
  if (!durMs || durMs <= 0) {
    throw new Error(`Invalid duration "${cfg?.duration}"`);
  }

  const endLocalMs = startLocalMs + durMs;

  // 4) convert the *shop-local* wall times back to UTC for Shopify API
  const starts_at_iso = new Date(startLocalMs - offsetMin * 60 * 1000).toISOString();
  const ends_at_iso   = new Date(endLocalMs   - offsetMin * 60 * 1000).toISOString();

  // 5) return also Date objects for DB storage (your DB may drop time if column is DATE)
  return {
    tz,
    offsetMin,
    starts_at_iso,
    ends_at_iso,
    startLocalDate: new Date(startLocalMs), // shop wall time
    endLocalDate:   new Date(endLocalMs),   // shop wall time
  };
}

function parseDurationMs(s) {
  if (!s || typeof s !== "string") return 0;
  const str = s.trim().toLowerCase();

  // quick patterns like "90 minutes", "2 hours", "3 days", "2 weeks", "1 month"
  const m = str.match(/^(\d+)\s*(minute|minutes|min|hour|hours|day|days|week|weeks|month|months)$/i);
  if (m) {
    const n = Number(m[1]);
    const u = m[2];
    if (/minute|min/.test(u)) return n * 60 * 1000;
    if (/hour/.test(u))       return n * 60 * 60 * 1000;
    if (/day/.test(u))        return n * 24 * 60 * 60 * 1000;
    if (/week/.test(u))       return n * 7  * 24 * 60 * 60 * 1000;
    if (/month/.test(u))      return n * 30 * 24 * 60 * 60 * 1000; // calendar months are tricky; 30d is a pragmatic default
  }

  // ISO 8601 durations like "PT72H" (optional)
  const iso = str.match(/^P(T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (iso) {
    const h = Number(iso[2] || 0);
    const mm = Number(iso[3] || 0);
    const ss = Number(iso[4] || 0);
    return (h * 3600 + mm * 60 + ss) * 1000;
  }

  return 0;
}
