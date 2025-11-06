// app/utils/natural-duration.server.js
import { Temporal } from "@js-temporal/polyfill";

/**
 * Convenience: add a natural-language duration from a start, *in the shop's timezone*,
 * and return the resulting UTC ISO string.
 */
export function addDurationUTCForShop(duration, start, shopTimeZone) {
  const add = makeAddDurationUTCForShop(shopTimeZone || "UTC");
  return add(duration, start);
}

/**
 * Factory that returns (duration, [start]) => UTC ISO string
 */
export function makeAddDurationUTCForShop(shopTimeZone) {
  if (!shopTimeZone) throw new Error("shopTimeZone (IANA) is required");

  return function addDurationUTC(duration, start = undefined) {
    const zdtStart = resolveStartInShopZone(start, shopTimeZone);
    const durBag = parseDurationToTemporal(duration);
    const zdtEnd = zdtStart.add(durBag);
    return zdtEnd.toInstant().toString(); // UTC ISO
  };
}

function resolveStartInShopZone(start, tz) {
  const timeZone = Temporal.TimeZone.from(tz);
  if (start == null) return Temporal.Now.zonedDateTimeISO(timeZone);

  if (start instanceof Date) {
    if (isNaN(start.getTime())) throw new Error("Invalid start date");
    return Temporal.Instant.from(start.toISOString()).toZonedDateTimeISO(timeZone);
  }
  if (typeof start === "number") {
    return Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(timeZone);
  }
  if (typeof start === "string") {
    const s = start.trim();
    const hasOffset = /[zZ]|[+-]\d{2}:\d{2}$/.test(s);
    if (hasOffset) return Temporal.ZonedDateTime.from(s).withTimeZone(timeZone);
    const pdt = Temporal.PlainDateTime.from(s); // interpret as local wall time in shop TZ
    return timeZone.getZonedDateTimeFor(pdt);
  }
  throw new Error("Unsupported start value");
}

// ---- Natural language parsing → {days,hours,minutes,seconds,milliseconds}
function parseDurationToTemporal(input) {
  if (typeof input !== "string" || !input.trim()) input = "7 days";
  const s = input.trim().toLowerCase();

  // ISO-like "P7D"
  const isoDay = s.match(/^p(\d+)d$/i);
  if (isoDay) return { days: parseInt(isoDay[1], 10), hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };

  // "hh:mm[:ss]" → treat as hours:minutes[:seconds]
  const colon = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    const h = parseInt(colon[1], 10);
    const m = parseInt(colon[2], 10);
    const sec = colon[3] != null ? parseInt(colon[3], 10) : 0;
    if (m >= 60 || sec >= 60) throw new Error("Minutes/seconds must be < 60 in hh:mm[:ss]");
    return { days: 0, hours: h, minutes: m, seconds: sec, milliseconds: 0 };
  }

  const acc = { days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };
  const parts = [...s.matchAll(/([a-z0-9.\s-]+?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g)];
  if (parts.length === 0) throw new Error(`Could not parse duration: "${input}"`);

  const put = (major, minor, base, v) => {
    const whole = Math.trunc(v);
    const frac = v - whole;
    acc[major] += whole;
    acc[minor] += frac * base;
  };
  const putSecs = (v) => {
    const whole = Math.trunc(v);
    const frac = v - whole;
    acc.seconds += whole;
    acc.milliseconds += Math.round(frac * 1000);
  };

  for (const [, rawVal, unit] of parts) {
    const v = parseValueString(rawVal.trim());
    const u = unit.toLowerCase();
    if (u === "day" || u === "days" || u === "d") put("days", "hours", 24, v);
    else if (["hour","hours","h","hr","hrs"].includes(u)) put("hours", "minutes", 60, v);
    else if (["minute","minutes","m","min","mins"].includes(u)) put("minutes", "seconds", 60, v);
    else if (["second","seconds","s","sec","secs"].includes(u)) putSecs(v);
  }

  // normalize
  if (acc.milliseconds >= 1000) { acc.seconds += Math.floor(acc.milliseconds / 1000); acc.milliseconds %= 1000; }
  if (acc.seconds >= 60) { acc.minutes += Math.floor(acc.seconds / 60); acc.seconds %= 60; }
  if (acc.minutes >= 60) { acc.hours += Math.floor(acc.minutes / 60); acc.minutes %= 60; }
  if (acc.hours >= 24) { acc.days += Math.floor(acc.hours / 24); acc.hours %= 24; }

  return acc;
}

function parseValueString(txt) {
  if (/^\d+(\.\d+)?$/.test(txt)) return parseFloat(txt);

  const half = txt.match(/^(.+?)\s+and a half$/);
  if (half) return wordsToNumber(half[1]) + 0.5;
  const quarter = txt.match(/^(.+?)\s+and a quarter$/);
  if (quarter) return wordsToNumber(quarter[1]) + 0.25;

  if (/^a?\s*half$/.test(txt)) return 0.5;
  if (/^a?\s*quarter$/.test(txt)) return 0.25;

  return wordsToNumber(txt);
}

function wordsToNumber(words) {
  const small = {
    zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
    ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16,
    seventeen:17, eighteen:18, nineteen:19
  };
  const tens = { twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };
  let total = 0, cur = 0;
  for (const tok of words.replace(/-/g, " ").split(/\s+/).filter(Boolean)) {
    const t = tok.toLowerCase();
    if (t === "and" || t === "a") continue;
    if (small[t] != null) cur += small[t];
    else if (tens[t] != null) cur += tens[t];
    else if (t === "hundred") cur = (cur || 1) * 100;
    else if (t === "thousand") { total += (cur || 1) * 1000; cur = 0; }
    else throw new Error(`Unrecognized number word: "${tok}"`);
  }
  return total + cur;
}
