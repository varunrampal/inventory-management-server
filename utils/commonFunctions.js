// utils/dateRange.js
import { DateTime } from "luxon";
import PLCounter from "../models/plCounter.js";    

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

// export async function nextPlSeq({ realmId, name, year = new Date().getFullYear() }, session) {
//   const doc = await PLCounter.findOneAndUpdate(
//     { realmId, name, year },
//     { $inc: { seq: 1 } },
//     { upsert: true, new: true, session }
//   );
//   return doc.seq;
// }

// export const formatPL = (seq, { prefix = "PL-", pad = 0 } = {}) =>
//   `${prefix}${pad ? String(seq).padStart(pad, "0") : seq}`;

/**
 * Returns next integer for (realmId, "pottinglist", year).
 * Strategy:
 *  1) ensure the counter doc exists (ignore E11000 if another request created it)
 *  2) increment WITHOUT upsert (avoids first-creator race)
 */
export async function nextPlSeq({ realmId, year = new Date().getFullYear() }) {
  const q = { realmId, name: "pottinglist", year };
  let attempts = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  while (attempts < 6) {
    attempts++;
    try {
      // Ensure the doc exists once
      try {
        await PLCounter.create({ ...q, seq: 0 });
      } catch (e) {
        if (e?.code !== 11000) throw e; // ignore duplicate if another request created it
      }

      // Increment without upsert (no race here)
      const doc = await PLCounter.findOneAndUpdate(q, { $inc: { seq: 1 } }, { new: true });
      if (!doc) throw new Error("Counter doc missing after ensure");
      return doc.seq;
    } catch (err) {
      // transient/backoff & retry
      await sleep(15 * attempts);
      if (attempts >= 6) throw new Error("Failed to allocate counter after retries");
    }
  }
}

export function formatPL(seq, { prefix = "PL-", pad = 0 } = {}) {
  return `${prefix}${pad ? String(seq).padStart(pad, "0") : seq}`;
}

export async function runTxnWithRetry(session, fn, { attempts = 5, backoffMs = 20 } = {}) {
  let tryNo = 0;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  while (true) {
    tryNo++;
    try {
      // withTransaction already retries on some errors, but we add our own guard
      return await session.withTransaction(async () => fn(session), {
        // good defaults for multi-doc writes
        writeConcern: { w: 'majority' },
        readConcern: { level: 'snapshot' },
        maxCommitTimeMS: 10000,
      });
    } catch (err) {
      const labels = err?.errorLabels || [];
      const isTransient = labels.includes('TransientTransactionError') || labels.includes('UnknownTransactionCommitResult');

      // Mongoose sometimes wraps error; keep both checks
      const isAbort = err?.name === 'MongoServerError' && /Transaction .* has been aborted/i.test(err?.message);

      if ((isTransient || isAbort) && tryNo < attempts) {
        await sleep(backoffMs * tryNo); // linear backoff
        continue; // retry whole txn
      }
      throw err; // give up
    }
  }
}