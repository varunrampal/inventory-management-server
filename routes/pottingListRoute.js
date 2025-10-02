// routes/pottinglists.js
import express from 'express';
import mongoose from "mongoose";
import { PottingList, ITEM_STATUSES, LIST_STATUSES } from "../models/PottingList.js";
import { nextPlSeq, formatPL, runTxnWithRetry  } from "../utils/commonFunctions.js";


const router = express.Router();
const SEASONS = ["Spring", "Summer", "Fall", "Winter"];

// router.post("/create", async (req, res) => {

//     const session = await mongoose.startSession();
//     try {
//         const {
//             reference,        // list-level only
//             customerName,
//             year,
//             season,
//             status,           // list-level status
//             estimateId,
//             docNumber,
//             realmId,
//             items,
//         } = req.body || {};

//         console.log("Create potting list payload:", req.body);

//         if (!customerName) return res.status(400).json({ error: "customerName is required" });
//         if (typeof year !== "number") return res.status(400).json({ error: "year (number) is required" });
//         if (!SEASONS.includes(season)) {
//             return res.status(400).json({ error: `season must be one of: ${SEASONS.join(", ")}` });
//         }
//         if (!Array.isArray(items) || items.length === 0) {
//             return res.status(400).json({ error: "items[] is required and cannot be empty" });
//         }
//         if (status && !LIST_STATUSES.includes(status)) {
//             return res.status(400).json({ error: `status must be one of: ${LIST_STATUSES.join(", ")}` });
//         }

//         // No item.reference here
//         const normalizedItems = items
//             .map((it) => ({
//                 name: String(it?.name || "").trim(),
//                 size: String(it?.size || "").trim(),
//                 quantity: Number(it?.quantity || 0),
//                 status: ITEM_STATUSES.includes(it?.status) ? it.status : "Pending",
//             }))
//             .filter((it) => it.name.length > 0);

//         let created = false;
//         let doc;

//         await session.withTransaction(async () => {
//             const existing = await PottingList.findOne(filter).session(session);

//             if (existing) {
//                 await PottingList.updateOne({ _id: existing._id }, { $set: baseSet }, { session });
//                 doc = await PottingList.findById(existing._id).session(session);
//                 created = false;
//                 return;
//             }

//             // Not found -> allocate next sequence for potting lists
//             const seq = await nextSeq({ realmId, name: "pottinglist", year }, session);
//             const code = formatCode(seq, { prefix: "PL-", pad: 0 }); // pad if you want "PL-00123"

//             const [createdDoc] = await PottingList.create([{ ...baseSet, seq, code }], { session });
//             doc = createdDoc;
//             created = true;
//         });

//         return res.status(created ? 201 : 200).json({ created, doc });
//     } catch (err) {
//         console.error("Create/Update potting list error:", err);
//         return res.status(500).json({ error: "Internal server error" });
//     } finally {
//         session.endSession();
//     }
// });


// router.post("/create", async (req, res) => {
//     const session = await mongoose.startSession();
//   try {
//     const {
//       reference,        // list-level only (optional)
//       customerName,
//       year,
//       season,
//       status,           // list-level status (optional)
//       estimateId,
//       docNumber,
//       realmId,
//       items,
//     } = req.body || {};

//     if (!customerName) return res.status(400).json({ error: "customerName is required" });
//     if (typeof year !== "number") return res.status(400).json({ error: "year (number) is required" });
//     if (!SEASONS.includes(season)) {
//       return res.status(400).json({ error: `season must be one of: ${SEASONS.join(", ")}` });
//     }
//     if (!Array.isArray(items) || items.length === 0) {
//       return res.status(400).json({ error: "items[] is required and cannot be empty" });
//     }
//     if (status && !LIST_STATUSES.includes(status)) {
//       return res.status(400).json({ error: `status must be one of: ${LIST_STATUSES.join(", ")}` });
//     }

//     const normalizedItems = items
//       .map((it) => ({
//         name: String(it?.name || "").trim(),
//         size: String(it?.size || "").trim(),
//         quantity: Number(it?.quantity || 0),
//         status: ITEM_STATUSES.includes(it?.status) ? it.status : "Pending",
//       }))
//       .filter((it) => it.name.length > 0);

//     // Identify an existing list (choose your key policy)
//     const filter = { realmId, year, season };
//     if (estimateId) filter.estimateId = String(estimateId);
//     else if (docNumber) filter.docNumber = String(docNumber);
//     else if (reference) filter.reference = String(reference).trim();
//     else {
//       return res.status(400).json({
//         error: "At least one of estimateId, docNumber, or reference is required.",
//       });
//     }

//     // Build $set without undefined values
//     const set = {
//       realmId,
//       customerName: String(customerName).trim(),
//       year,
//       season,
//       items: normalizedItems,
//     };
//     if (estimateId != null) set.estimateId = String(estimateId);
//     if (docNumber != null) set.docNumber = String(docNumber);
//     if (status && LIST_STATUSES.includes(status)) set.status = status;
//     if (typeof reference === "string" && reference.trim()) set.reference = reference.trim(); // <-- only here

//     const opts = {
//       new: true,
//       upsert: true,
//       setDefaultsOnInsert: true,
//       rawResult: true, // lets us tell created vs updated
//     };

//     let created = false;
//     let doc;

//     await session.withTransaction(async () => {
//       const existing = await PottingList.findOne(filter).session(session);

//       if (existing) {
//         await PottingList.updateOne({ _id: existing._id }, { $set: baseSet }, { session });
//         doc = await PottingList.findById(existing._id).session(session);
//         created = false;
//         return;
//       }

//       // Not found -> allocate next sequence for potting lists
//       const seq = await nextPlSeq({ realmId, name: "pottinglist", year }, session);
//       const code = formatPL(seq, { prefix: "PL-", pad: 0 }); // pad if you want "PL-00123"

//       const [createdDoc] = await PottingList.create([{ ...baseSet, seq, code }], { session });
//       doc = createdDoc;
//       created = true;
//     });

//     return res.status(created ? 201 : 200).json({ created, doc });
//   } catch (err) {
//     console.error("Create/Update potting list error:", err);
//     return res.status(500).json({ error: "Internal server error" });
//   } finally {
//     session.endSession();
//   }
// });


router.post("/create", async (req, res) => {
  try {
    const {
      reference,
      customerName,
      year,
      season,
      status,
      estimateId,
      docNumber,
      realmId,
      items,
    } = req.body || {};

    if (!customerName) return res.status(400).json({ error: "customerName is required" });
    if (typeof year !== "number") return res.status(400).json({ error: "year (number) is required" });
    if (!SEASONS.includes(season)) {
      return res.status(400).json({ error: `season must be one of: ${SEASONS.join(", ")}` });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items[] is required and cannot be empty" });
    }
    if (status && !LIST_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${LIST_STATUSES.join(", ")}` });
    }
    if (!realmId) return res.status(400).json({ error: "realmId is required" });

    const normalizedItems = items
      .map((it) => ({
        name: String(it?.name || "").trim(),
        size: String(it?.size || "").trim(),
        quantity: Number(it?.quantity || 0),
        status: ITEM_STATUSES.includes(it?.status) ? it.status : "Pending",
      }))
      .filter((it) => it.name.length > 0);

    // Uniqueness key for "one list per..." policy
    const filter = { realmId, year, season };
    if (estimateId) filter.estimateId = String(estimateId);
    else if (docNumber) filter.docNumber = String(docNumber);
    else if (reference) filter.reference = String(reference).trim();
    else {
      return res.status(400).json({
        error: "At least one of estimateId, docNumber, or reference is required.",
      });
    }

    const baseSet = {
      realmId,
      customerName: String(customerName).trim(),
      year,
      season,
      items: normalizedItems,
    };
    if (estimateId != null) baseSet.estimateId = String(estimateId);
    if (docNumber != null) baseSet.docNumber = String(docNumber);
    if (status && LIST_STATUSES.includes(status)) baseSet.status = status;
    if (typeof reference === "string" && reference.trim()) baseSet.reference = reference.trim();

    // 1) If exists → update + return
    const existing = await PottingList.findOne(filter).lean();
    if (existing) {
      await PottingList.updateOne({ _id: existing._id }, { $set: baseSet });
      const doc = await PottingList.findById(existing._id).lean();
      return res.status(200).json({ created: false, doc });
    }

    // 2) Not found → allocate PL number and insert
    const seq = await nextPlSeq({ realmId, year });
    const code = formatPL(seq, { prefix: "PL-", pad: 0 });

    try {
      const created = await PottingList.create({ ...baseSet, seq, code });
      return res.status(201).json({ created: true, doc: created.toObject() });
    } catch (err) {
      // Lost race; return winner or retry once if clash was on code
      if (err?.code === 11000) {
        const winner = await PottingList.findOne(filter).lean();
        if (winner) return res.status(200).json({ created: false, doc: winner });

        if (/code/.test(String(err?.message))) {
          const seq2 = await nextPlSeq({ realmId, year });
          const code2 = formatPL(seq2, { prefix: "PL-", pad: 0 });
          const created2 = await PottingList.create({ ...baseSet, seq: seq2, code: code2 });
          return res.status(201).json({ created: true, doc: created2.toObject() });
        }
      }
      throw err;
    }
  } catch (err) {
    console.error("Create/Update potting list error:", {
      name: err?.name,
      message: err?.message,
      code: err?.code,
      labels: err?.errorLabels,
    });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/for-estimate", async (req, res) => {
    try {
        const { realmId, estimateId, docNumber, reference, year, season } = req.query || {};
        if (!realmId) return res.status(400).json({ error: "realmId is required" });

        const filter = { realmId };
        if (estimateId) filter.estimateId = String(estimateId);
        else if (docNumber) filter.docNumber = String(docNumber);
        else if (reference) filter.reference = String(reference).trim();
        else return res.status(400).json({ error: "Provide estimateId or docNumber or reference" });

        if (year) filter.year = Number(year);
        if (season) filter.season = season;

        const doc = await PottingList.findOne(filter).sort({ updatedAt: -1 });
        if (!doc) return res.status(404).json({ found: false });
        return res.json({ found: true, doc });
    } catch (err) {
        console.error("Lookup potting list error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * Query params:
 *  - year: Number (e.g., 2025)
 *  - season: String (e.g., "Spring" | "Summer" | "Fall" | "Winter")
 *  - customer: String (partial match)
 *  - size: String (exact match, e.g., "#1", "10 cm")
 *  - page: Number (default 1)
 *  - limit: Number (default 20)
 */
router.get("/", async (req, res) => {
  try {
    // const realmId = req.user.realmId || req.query.realmId; // however you pass it

    const realmId =
      req.user?.realmId ||
      req.query.realmId ||
      req.headers["x-realm-id"];

    if (!realmId) return res.status(400).json({ error: "realmId is required" });

    const {
      year,
      season,
      customer,
      size,
      page = 1,
      limit = 20,
      sort = "-updatedAt",
    } = req.query;

    const criteria = { realmId };

    if (year) criteria.year = Number(year);
    if (season) criteria.season = season;

    if (customer && customer.trim()) {
      // case-insensitive partial match
      criteria.customerName = { $regex: customer.trim(), $options: "i" };
    }

    if (size && size.trim()) {
      // item-level filter: any item with this size
      criteria.items = { $elemMatch: { size: size.trim() } };
      // If some old lists stored size in name, you could broaden with $or:
      // criteria.$or = [
      //   { items: { $elemMatch: { size: size.trim() } } },
      //   { "items.name": { $regex: `\\b${escapeRegExp(size.trim())}\\b`, $options: "i" } }
      // ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [rows, total] = await Promise.all([
      PottingList.find(criteria)
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .select({
          _id: 1,
          code: 1,
          docNumber: 1,     // e.g., human-friendly PL code if you have it
          year: 1,
          season: 1,
          customerName: 1,
          status: 1,
          reference: 1,
          updatedAt: 1,
          // lightweight items projection (omit heavy fields)
          items: { $slice: 0 }, // don’t send items list for the listing page (optional)
        })
        .lean(),
      PottingList.countDocuments(criteria),
    ]);

    res.json({
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit)),
      rows,
    });
  } catch (err) {
    console.error("GET /pottinglists error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    console.log('asdasdasdasd');
    const { id } = req.params;
    const realmId = req.user?.realmId || req.query.realmId || req.headers["x-realm-id"];
    if (!realmId) return res.status(400).json({ error: "realmId is required" });

    const doc = await PottingList.findOne({ _id: id, realmId }).lean();
    if (!doc) return res.status(404).json({ error: "Not found" });

    res.json(doc);
  } catch (e) {
    console.error("GET /pottinglists/:id", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Query params:
 *  - year: Number     (optional)
 *  - season: String   (optional)
 *  - customer: String (optional, partial match)
 *  - top: Number      (optional; top N items per size; default 50)
 *  - sort: String     (optional; "size" | "totalDesc" | "totalAsc")
 *
 * Response shape:
 * [
 *   {
 *     size: "#1",
 *     sizeTotal: 1234,
 *     items: [{ name: "Alnus rubra", size: "#1", totalQty: 450 }, ...]
 *   },
 *   ...
 * ]
 */
router.get("/report/by-size", async (req, res) => {
  try {
    const realmId =
      req.user?.realmId ||
      req.query.realmId ||
      req.headers["x-realm-id"];

    if (!realmId) {
      return res.status(400).json({ error: "realmId is required" });
    }

    const { year, season, customer, top = 50, sort = "totalDesc" } = req.query;

    const match = { realmId };
    if (year)   match.year = Number(year);
    if (season) match.season = season;
    if (customer?.trim()) {
      match.customerName = { $regex: customer.trim(), $options: "i" };
    }

    const pipeline = [
      { $match: match },
      { $unwind: "$items" },

      // normalize fields and guard nulls/strings
      {
        $set: {
          "items.size": { $ifNull: [{ $trim: { input: "$items.size" } }, "Unknown"] },
          "items.name": { $ifNull: [{ $trim: { input: "$items.name" } }, "Unnamed item"] },
          _q: { $toDouble: { $ifNull: ["$items.quantity", 0] } },
        }
      },

      // Sum per (size, name)
      {
        $group: {
          _id: { size: "$items.size", name: "$items.name" },
          totalQty: { $sum: "$_q" },
        }
      },

      // Sort items within size before regrouping (so push keeps order)
      { $sort: { "_id.size": 1, totalQty: -1, "_id.name": 1 } },

      // Regroup by size to get size total + ordered items list
      {
        $group: {
          _id: "$_id.size",
          sizeTotal: { $sum: "$totalQty" },
          items: {
            $push: {
              name: "$_id.name",
              size: "$_id.size",
              totalQty: "$totalQty",
            }
          }
        }
      },

      // Optional top N per size
      {
        $project: {
          _id: 0,
          size: "$_id",
          sizeTotal: 1,
          items: { $slice: ["$items", { $toInt: top }] }
        }
      },
    ];

    // final sort of size groups
    if (sort === "size") {
      pipeline.push({ $sort: { size: 1 } });
    } else if (sort === "totalAsc") {
      pipeline.push({ $sort: { sizeTotal: 1 } });
    } else {
      // "totalDesc" default
      pipeline.push({ $sort: { sizeTotal: -1 } });
    }

    const rows = await PottingList.aggregate(pipeline).allowDiskUse(true);
    res.json(rows);
  } catch (err) {
    console.error("GET /pottinglists/report/by-size error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
