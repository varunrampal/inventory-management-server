// utils/dateRange.js
import { DateTime } from "luxon";

export function nextWeekRange(tz = "America/Vancouver") {
  const now = DateTime.now().setZone(tz);
  const start = now.startOf("week").plus({ weeks: 1 }); // ✅ next Monday 00:00
  const end   = start.plus({ days: 7 });                // (exclusive)
  return { from: start, to: end };
}

export function getWeekRanges(tz = "America/Vancouver") {
  const now = DateTime.now().setZone(tz);
  const currentFrom = now.set({ weekday: 1 }).startOf("day"); // Monday 00:00
  const currentTo   = currentFrom.plus({ days: 7 });          // exclusive
  const nextFrom    = currentFrom.plus({ weeks: 1 });
  const nextTo      = nextFrom.plus({ days: 7 });
  return {
    current: { from: currentFrom, to: currentTo },
    next:    { from: nextFrom,    to: nextTo },
  };
}


export function toAddressString(addr = {}) {
  if (!addr) return "";
  const {
    Line1, Line2, Line3, Line4, Line5,
    City, CountrySubDivisionCode, PostalCode, Country
  } = addr || {};
  const lines = [
    Line1, Line2, Line3, Line4, Line5,
    [City, CountrySubDivisionCode, PostalCode].filter(Boolean).join(", "),
    Country
  ].filter(Boolean);
  return lines.join("\n");
}