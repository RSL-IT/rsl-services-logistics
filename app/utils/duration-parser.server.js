// app/utils/duration-parser.server.js
// DST-safe (Temporal) when available; non-crashing UTC fallback otherwise.

import * as TemporalNS from "@js-temporal/polyfill";

// Resolve a usable Temporal reference without optional chaining / nullish coalescing.
var T = (TemporalNS && TemporalNS.Temporal) ? TemporalNS.Temporal : TemporalNS;
var HAS_TEMPORAL = !!(T && T.TimeZone && typeof T.TimeZone.from === "function");

// -------- Optional sanity print --------
var SANITY_PRINT = true;
if (SANITY_PRINT) {
  var env = (typeof process !== "undefined" && process.env && process.env.NODE_ENV) ? process.env.NODE_ENV : "unknown";
  console.log("[duration-parser] Temporal OK?", HAS_TEMPORAL, "| Node env:", env);
}
// --------------------------------------

/**
 * Factory returning an addDurationUTC(duration, [start]) function bound to a shop IANA timezone.
 * @param {string} shopTimeZone - e.g., "America/Chicago"
 * @returns {(duration: string, start?: Date|string|number) => string} UTC ISO string
 */
export function makeAddDurationUTCForShop(shopTimeZone) {
  if (!shopTimeZone || typeof shopTimeZone !== "string") {
    throw new Error("shopTimeZone (IANA string) is required");
  }

  if (HAS_TEMPORAL) {
    // Validate zone immediately (throws if invalid).
    T.TimeZone.from(shopTimeZone);

    return function addDurationUTC(duration, start) {
      var zdtStart = resolveStartInShopZone_Temporal(start, shopTimeZone); // ZonedDateTime
      var dur = parseDurationToBag(duration);                              // {days,hours,minutes,seconds,milliseconds}
      var zdtEnd = zdtStart.add(dur);                                      // DST-safe arithmetic
      return zdtEnd.toInstant().toString();                                // UTC ISO string
    };
  }

  // ----- Soft fallback (no Temporal) -----
  console.warn(
    '[duration-parser] Temporal not available; using naive UTC fallback (24h days, server-local parsing). ' +
    'Install "@js-temporal/polyfill" as a production dependency for DST-safe behavior.'
  );

  return function addDurationUTC_naive(duration, start) {
    var dur = parseDurationToBag(duration);
    var startDate = coerceStartToDate_naive(start); // Date in server local time / parsed offset
    var ms =
      (dur.days || 0) * 86400000 +
      (dur.hours || 0) * 3600000 +
      (dur.minutes || 0) * 60000 +
      (dur.seconds || 0) * 1000 +
      (dur.milliseconds || 0);

    var end = new Date(startDate.getTime() + ms);
    return new Date(end.getTime() - end.getTimezoneOffset() * 60000).toISOString().replace(".000Z", "Z");
  };
}

/* ===================== Temporal branch helpers ===================== */

function resolveStartInShopZone_Temporal(start, tz) {
  var timeZone = T.TimeZone.from(tz);

  if (start == null) return T.Now.zonedDateTimeISO(timeZone);

  if (start instanceof Date) {
    if (isNaN(start.getTime())) throw new Error("Invalid start date");
    return T.Instant.from(start.toISOString()).toZonedDateTimeISO(timeZone);
  }

  if (typeof start === "number") {
    return T.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(timeZone);
  }

  if (typeof start === "string") {
    var s = normalizeStartString(start);
    var hasOffset = /[zZ]|[+-]\d{2}:\d{2}$/.test(s);
    if (hasOffset) {
      // Absolute string with offset/zone; then display in shop zone (same instant).
      return T.ZonedDateTime.from(s).withTimeZone(timeZone);
    } else {
      // Interpret as local wall time in shop zone.
      var cleaned = s.indexOf("T") >= 0 ? s : s.replace(" ", "T");
      var pdt = T.PlainDateTime.from(cleaned);
      return timeZone.getZonedDateTimeFor(pdt);
    }
  }

  throw new Error("Unsupported start value");
}

function normalizeStartString(s) {
  // collapse whitespace
  var out = String(s || "").trim().replace(/\s+/g, " ");
  // remove parentheticals like "(meaning 5 hours, 20 minutes)"
  out = out.replace(/\([^)]*\)/g, "").trim();
  return out;
}

/* ===================== Naive fallback helpers ===================== */

function coerceStartToDate_naive(start) {
  if (start == null) return new Date();
  if (start instanceof Date) {
    if (isNaN(start.getTime())) throw new Error("Invalid start date");
    return start;
  }
  if (typeof start === "number") return new Date(start);
  if (typeof start === "string") {
    var s = normalizeStartString(start);
    var d = new Date(s);
    if (isNaN(d.getTime())) {
      // Attempt to normalize "YYYY-MM-DD HH:mm" → "YYYY-MM-DDTHH:mm"
      var cleaned = s.indexOf("T") >= 0 ? s : s.replace(" ", "T");
      d = new Date(cleaned);
    }
    if (isNaN(d.getTime())) throw new Error('Unable to parse "start" in fallback: ' + start);
    return d;
  }
  throw new Error("Unsupported start value");
}

/* ===================== Shared: duration parsing ===================== */

// Returns a plain bag: {days,hours,minutes,seconds,milliseconds}
function parseDurationToBag(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Expected non-empty duration string");
  }

  // Clean up: lower case, strip parentheticals like "(meaning ...)"
  var s = input.trim().toLowerCase().replace(/\([^)]*\)/g, "").trim();

  // "hh:mm" or "hh:mm:ss"
  var colon = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    var h = parseInt(colon[1], 10);
    var m = parseInt(colon[2], 10);
    var sec = colon[3] != null ? parseInt(colon[3], 10) : 0;
    if (m >= 60 || sec >= 60) throw new Error("Minutes/seconds must be < 60 in hh:mm[:ss]");
    return { days: 0, hours: h, minutes: m, seconds: sec, milliseconds: 0 };
  }

  var acc = { days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };

  // Accepts things like:
  // "4 days, 10 hours", "3 days 2 hours and 15 minutes", "five and a half minutes", "10 seconds"
  var it = s.matchAll(/([a-z0-9.\s-]+?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g);
  var any = false;

  for (var mIt = it.next(); !mIt.done; mIt = it.next()) {
    any = true;
    var match = mIt.value;
    var rawVal = match[1].trim().replace(/-+/g, " "); // "three and a half"
    var unitRaw = match[2].toLowerCase();             // e.g., "days"
    var unit = normalizeUnit(unitRaw);                // -> "day" | "hour" | "minute" | "second" | "d" | "h" | "m" | "s" | "hr" | "hrs" | "min" | "mins" | "sec" | "secs"
    var value = parseValueString(rawVal);

    applyUnit(acc, unit, value);
  }

  if (!any) throw new Error('Could not parse duration: "' + input + '"');

  // normalize carries
  if (acc.milliseconds >= 1000) {
    acc.seconds += Math.floor(acc.milliseconds / 1000);
    acc.milliseconds = acc.milliseconds % 1000;
  }
  if (acc.seconds >= 60) {
    acc.minutes += Math.floor(acc.seconds / 60);
    acc.seconds = acc.seconds % 60;
  }
  if (acc.minutes >= 60) {
    acc.hours += Math.floor(acc.minutes / 60);
    acc.minutes = acc.minutes % 60;
  }
  if (acc.hours >= 24) {
    acc.days += Math.floor(acc.hours / 24);
    acc.hours = acc.hours % 24;
  }

  return acc;
}

function normalizeUnit(u) {
  // Map common plurals to singular
  if (u === "days") return "day";
  if (u === "hours") return "hour";
  if (u === "minutes") return "minute";
  if (u === "seconds") return "second";
  // already singular / abbrev
  return u;
}

function applyUnit(acc, unit, value) {
  switch (unit) {
    case "day":
    case "d":
      splitDown(acc, value, "days", "hours", 24);
      return;
    case "hour":
    case "h":
    case "hr":
    case "hrs":
      splitDown(acc, value, "hours", "minutes", 60);
      return;
    case "minute":
    case "m":
    case "min":
    case "mins":
      splitDown(acc, value, "minutes", "seconds", 60);
      return;
    case "second":
    case "s":
    case "sec":
    case "secs":
      splitSeconds(acc, value);
      return;
    default:
      throw new Error("Unsupported unit: " + unit);
  }
}

function splitDown(acc, v, major, minor, base) {
  var whole = Math.trunc(v);
  var frac = v - whole;
  acc[major] += whole;
  acc[minor] += frac * base;
}

function splitSeconds(acc, v) {
  var whole = Math.trunc(v);
  var frac = v - whole;
  acc.seconds += whole;
  acc.milliseconds += Math.round(frac * 1000);
}

function parseValueString(txt) {
  var t = String(txt || "").trim();

  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);

  var mHalf = t.match(/^(.+?)\s+and a half$/);
  if (mHalf) return wordsToNumber(mHalf[1]) + 0.5;

  var mQuarter = t.match(/^(.+?)\s+and a quarter$/);
  if (mQuarter) return wordsToNumber(mQuarter[1]) + 0.25;

  if (/^(?:a\s+)?half$/.test(t)) return 0.5;
  if (/^(?:a\s+)?quarter$/.test(t)) return 0.25;
  if (/^half\s+an$/.test(t)) return 0.5; // "half an"

  return wordsToNumber(t);
}

function wordsToNumber(words) {
  var small = {
    zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
    ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16,
    seventeen:17, eighteen:18, nineteen:19
  };
  var tens = { twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };

  var total = 0, current = 0;
  var tokens = words.replace(/-/g, " ").split(/\s+/).filter(Boolean);
  for (var i = 0; i < tokens.length; i++) {
    var tok = tokens[i].toLowerCase();
    if (tok === "and" || tok === "a" || tok === "an") continue;
    if (Object.prototype.hasOwnProperty.call(small, tok)) {
      current += small[tok];
    } else if (Object.prototype.hasOwnProperty.call(tens, tok)) {
      current += tens[tok];
    } else if (tok === "hundred") {
      current = (current || 1) * 100;
    } else if (tok === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
    } else {
      throw new Error('Unrecognized number word: "' + tok + '"');
    }
  }
  return total + current;
}
