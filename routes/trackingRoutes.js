// routes/trackingRoutes.js
import express from "express";
import { DriverLocation } from "../models/DriverLocation.js";
import { DriverLocationHistory } from "../models/DriverLocationHistory.js"; // new

const router = express.Router();

// DRIVER → sends location repeatedly
// router.post("/update", async (req, res) => {
//   try {
//     const { driverId, lat, lng } = req.body;
//     if (!driverId || lat == null || lng == null) {
//       return res.status(400).json({ error: "driverId, lat, lng are required" });
//     }

//     const doc = await DriverLocation.findOneAndUpdate(
//       { driverId },
//       { lat, lng, updatedAt: new Date() },
//       { upsert: true, new: true }
//     );
//     console.log(doc);

//     res.json({ success: true, location: doc });
//   } catch (err) {
//     console.error("Update location error:", err);
//     res.status(500).json({ error: "Server error" });
//   }
// });

// DRIVER APP → sends location (POST /admin/tracking/update)
router.post("/update", async (req, res) => {
  try {
    const { driverId, lat, lng } = req.body;

    if (!driverId || lat == null || lng == null) {
      return res
        .status(400)
        .json({ error: "driverId, lat, lng are required" });
    }

    // 1) Update latest location (single doc per driver)
    const latest = await DriverLocation.findOneAndUpdate(
      { driverId },
      { lat, lng, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    // 2) Append to history (one doc per point)
    const historyPoint = await DriverLocationHistory.create({
      driverId,
      lat,
      lng,
      timestamp: new Date(),
    });

    console.log("📍 Location update:", driverId, lat, lng);

    res.json({
      success: true,
      latest,
      historyPointId: historyPoint._id,
    });
  } catch (err) {
    console.error("Update location error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// WEBSITE → get all driver locations
router.get("/", async (_req, res) => {
  try {
    const docs = await DriverLocation.find({});
    res.json(docs);
  } catch (err) {
    console.error("Get all locations error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// WEBSITE → get latest location for one driver
router.get("/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;
    const doc = await DriverLocation.findOne({ driverId });

    if (!doc) return res.status(404).json({ error: "No location for driver" });
    res.json(doc);
  } catch (err) {
    console.error("Get location error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// in routes/adminTrackingRoutes.js

// WEBSITE → full path for one driver (last X minutes)
router.get("/history/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;
    const minutes = Number(req.query.minutes || 60); // default last 60 mins

    const since = new Date(Date.now() - minutes * 60 * 1000);

    const points = await DriverLocationHistory.find({
      driverId,
      timestamp: { $gte: since },
    })
      .sort({ timestamp: 1 }) // oldest → newest
      .lean();

    res.json(points);
  } catch (err) {
    console.error("Get history error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;



