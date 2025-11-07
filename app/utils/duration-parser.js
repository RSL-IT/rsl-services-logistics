// app/utils/duration-parser.server.js
// DST-safe duration adder bound to a Shopify shop's IANA time zone,
// written with conservative JS (ES2018) so Vite SSR won’t complain.

import { Temporal as TemporalPolyfill } from "@js-temporal/polyfill";

// Use an existing global Temporal if present; otherwise fall back to the polyfill.
// (No optional chaining or nullish coalescing to keep syntax conservative.)
var hasGlobalTemporal =
  typeof globalThis !== "undefined" &&
  globalThis.Temporal &&
  globalThis.Temporal.TimeZone &&
  typeof globalThis.Temporal.TimeZone.from === "function";

var T = hasGlobalTemporal ? globalThis.Temporal : TemporalPolyfill;

// Ensure downstream code that expects a global Temporal is satisfied.
if (typeof globalThis !== "undefined" && !globalThis.Temporal) {
  globalThis.Temporal = T;
}

// -------- Optional sanity print (set to false to silence) --------
var SANITY_PRINT = true;
if (SANITY_PRINT) {
  var ok = !!(T && T.TimeZone && typeof T.TimeZone.from === "function");
  var env = (typeof process !== "undefined" && process.env && process.env.NODE_ENV) ? process.env.NODE_ENV : "unknown";
  console.log("[duration-parser] Temporal OK?", ok, "| Node env:", env);
}
// ---------------------------------------------------------------

// Fail early with a clear message if the polyfill isn't present.
if (!(T && T.TimeZone && typeof T.TimeZone.from === "function")) {
  throw new Error(
    'Temporal polyfill failed to load. Ensure "@js-temporal/polyfill" is installed.'
  );
}

/**
 * Factory that returns an addDurationUTC(duration, [start]) function bound to a shop IANA time zone.
 * @param {string} shopTimeZone - IANA timezone, e.g., "America/Chicago"
 * @returns {(duration: string, start?: Date|string|number) => string} UTC ISO string
 */
export function makeAddDurationUTCForShop(shopTimeZone) {
  if (!shopTimeZone || typeof shopTimeZone !== "string") {
    throw new Error("shopTimeZone (IANA string) is required");
  }
  // Validate zone immediately; throws if invalid.
  T.TimeZone.from(shopTimeZone);

  return function addDurationUTC(duration, start) {
    var zdtStart = resolveStartInShopZone(start, shopTimeZone); // ZonedDateTime
    var dur = parseDurationToTemporal(duration);                // {days,hours,minutes,seconds,milliseconds}
    var zdtEnd = zdtStart.add(dur);                             // DST-safe arithmetic
    return zdtEnd.toInstant().toString();                       // UTC ISO string
  };
}

/* -------------------- Internal helpers -------------------- */

/**
 * Convert the "start" into a ZonedDateTime in the shop’s time zone.
 * - If start is missing: use "now" in that zone.
 * - If Date/epoch: treat as absolute instant.
 * - If string with offset/Z: absolute instant.
 * - Else: interpret as local wall time in the shop’s zone.
 */
function resolveStartInShopZone(start, tz) {
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
    var trimmed = start.trim();
    var hasOffset = /[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed);
    if (hasOffset) {
      // String carries an offset/zone (absolute)
      return T.ZonedDateTime.from(trimmed).withTimeZone(timeZone);
    } else {
      // Interpret as local wall time in the shop zone.
      // Normalize "YYYY-MM-DD HH:mm" → "YYYY-MM-DDTHH:mm"
      var cleaned = trimmed.indexOf("T") >= 0 ? trimmed : trimmed.replace(" ", "T");
      var pdt = T.PlainDateTime.from(cleaned);
      return timeZone.getZonedDateTimeFor(pdt);
    }
  }

  throw new Error("Unsupported start value");
}

/**
 * Parse human durations into a Temporal duration bag: {days,hours,minutes,seconds,milliseconds}
 * Supports:
 *  - "hh:mm" and "hh:mm:ss" (hours-based)
 *  - repeated "<value> <unit>" parts (commas/and allowed)
 *  - number words ("five and a half", "twenty one", etc.)
 */
function parseDurationToTemporal(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Expected non-empty duration string");
  }
  var s = input.trim().toLowerCase();

  // "hh:mm" or "hh:mm:ss"
  var colon = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    var h = parseInt(colon[1], 10);
    var m = parseInt(colon[2], 10);
    var sec = colon[3] != null ? parseInt(colon[3], 10) : 0;
    if (m >= 60 || sec >= 60) throw new Error("Minutes/seconds must be < 60 in hh:mm[:ss]");
    return { days: 0, hours: h, minutes: m, seconds: sec, milliseconds: 0 };
  }

  // Accumulator
  var acc = { days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };

  // Unit handlers (split fractional values down to smaller units)
  var unitHandlers = {
    day: function(v){ splitDown(v, "days", "hours", 24); },
    d:   function(v){ splitDown(v, "days", "hours", 24); },

    hour:function(v){ splitDown(v, "hours", "minutes", 60); },
    h:   function(v){ splitDown(v, "hours", "minutes", 60); },
    hr:  function(v){ splitDown(v, "hours", "minutes", 60); },
    hrs: function(v){ splitDown(v, "hours", "minutes", 60); },

    minute:function(v){ splitDown(v, "minutes", "seconds", 60); },
    min: function(v){ splitDown(v, "minutes", "seconds", 60); },
    mins:function(v){ splitDown(v, "minutes", "seconds", 60); },
    m:   function(v){ splitDown(v, "minutes", "seconds", 60); },

    second:function(v){ splitSeconds(v); },
    sec: function(v){ splitSeconds(v); },
    secs:function(v){ splitSeconds(v); },
    s:   function(v){ splitSeconds(v); }
  };

  var parts = s.matchAll(/([a-z0-9.\s-]+?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g);
  var hasAny = false;
  for (var it = parts.next(); !it.done; it = parts.next()) {
    hasAny = true;
    var match = it.value;
    var rawValue = match[1].trim().replace(/-+/g, " ");
    var unit = match[2].toLowerCase();
    var value = parseValueString(rawValue);
    var handler = unitHandlers[unit];
    if (!handler) throw new Error("Unsupported unit: " + unit);
    handler(value);
  }
  if (!hasAny) {
    throw new Error('Could not parse duration: "' + input + '"');
  }

  // Normalize carries
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

  function splitDown(v, major, minor, base) {
    var whole = Math.trunc(v);
    var frac = v - whole;
    acc[major] += whole;
    acc[minor] += frac * base;
  }
  function splitSeconds(v) {
    var whole = Math.trunc(v);
    var frac = v - whole;
    acc.seconds += whole;
    acc.milliseconds += Math.round(frac * 1000);
  }
}

function parseValueString(txt) {
  // numeric
  if (/^\d+(\.\d+)?$/.test(txt)) return parseFloat(txt);

  // "five and a half" / "ten and a quarter"
  var mHalf = txt.match(/^(.+?)\s+and a half$/);
  if (mHalf) return wordsToNumber(mHalf[1]) + 0.5;

  var mQuarter = txt.match(/^(.+?)\s+and a quarter$/);
  if (mQuarter) return wordsToNumber(mQuarter[1]) + 0.25;

  // "half" / "a half" / "quarter" / "a quarter"
  if (/^a?\s*half$/.test(txt)) return 0.5;
  if (/^a?\s*quarter$/.test(txt)) return 0.25;

  // words: "five", "twenty one", "one hundred twenty", etc.
  return wordsToNumber(txt);
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
    var t = tokens[i].toLowerCase();
    if (t === "and" || t === "a") continue;
    if (Object.prototype.hasOwnProperty.call(small, t)) {
      current += small[t];
    } else if (Object.prototype.hasOwnProperty.call(tens, t)) {
      current += tens[t];
    } else if (t === "hundred") {
      current = (current || 1) * 100;
    } else if (t === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
    } else {
      throw new Error('Unrecognized number word: "' + t + '"');
    }
  }
  return total + current;
}
