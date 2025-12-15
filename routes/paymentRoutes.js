// routes/paymentRoutes.js
import express from 'express';
import {PaymentEntry} from '../models/PaymentEntry.js';

const router = express.Router();
// Create a payment entry (cash / etransfer)
// router.post("/", async (req, res) => {
//   try {
//     const {
//       paymentDate,
//       customerName,
//       invoiceNumber,
//       paymentType,
//       amount,
//       receivedBy,
//       bankAccount,
//       bankReceivedDate,
//       bankReference,
//       depositSlipNumber,
//       postedInAccounting,
//       notes,
//     } = req.body;

//     const entry = new PaymentEntry({
//       paymentDate,
//       customerName,
//       invoiceNumber,
//       paymentType,
//       amount,
//       receivedBy,
//       bankAccount,
//       bankReceivedDate,
//       bankReference,
//       depositSlipNumber,
//       postedInAccounting,
//       notes,
//     });

//     await entry.save();
//     res.status(201).json(entry);
//   } catch (err) {
//     console.error("Create payment entry error:", err);
//     res.status(500).json({ error: "Server error creating payment entry" });
//   }
// });
// routes/paymentRoutes.js
router.post("/", async (req, res) => {
  try {
    const {
      companyId,
      companyName,
      paymentDate,
      customerName,
      invoiceNumber,
      paymentType,
      amount,
      receivedBy,
      bankAccount,
      bankReceivedDate,
      bankReference,
      depositSlipNumber,
      postedInAccounting,
      notes,
    } = req.body;

    console.log('body:'+ req.body);

    if (!companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }

    const entry = new PaymentEntry({
      companyId,
      companyName,
      paymentDate,
      customerName,
      invoiceNumber,
      paymentType,
      amount,
      receivedBy,
      bankAccount,
      bankReceivedDate,
      bankReference,
      depositSlipNumber,
      postedInAccounting,
      notes,
    });

    await entry.save();
    res.status(201).json(entry);
  } catch (err) {
    console.error("Create payment entry error:", err);
    res.status(500).json({ error: "Server error creating payment entry" });
  }
});

// Optional: list entries (with date filter)
// router.get("/", async (req, res) => {
//   try {
//     const { from, to } = req.query;
//     const filter = {};

//   //  if (from || to) {
//   //     filter.paymentDate = {};
//   //     if (from) filter.paymentDate.$gte = new Date(from);
//   //     if (to) {
//   //       const toDate = new Date(to);
//   //       // include the full day
//   //       toDate.setHours(23, 59, 59, 999);
//   //       filter.paymentDate.$lte = toDate;
//   //     }
//   //   }


//     const fromDate = new Date(from);       // UTC midnight
// const toDate = new Date(to);           // UTC midnight
// toDate.setDate(toDate.getDate() + 1);  // next day

// filter.paymentDate = {
//   $gte: fromDate,
//   $lt:  toDate,
// };

//     console.log(filter);

//     const entries = await PaymentEntry.find(filter).sort({ paymentDate: 1 });
//     res.json(entries);
//   } catch (err) {
//     console.error("Get payment entries error:", err);
//     res.status(500).json({ error: "Server error fetching entries" });
//   }
// });

// GET /admin/payments?from=2025-11-21&to=2025-11-21
// router.get("/", async (req, res) => {
//   try {
//     const { from, to } = req.query;
//     const filter = {};

//     if (from || to) {
//       const fromDate = from ? new Date(from) : null;
//       const toDate = to ? new Date(to) : null;

//       // We use >= fromDate and < (toDate + 1 day)
//       // so the whole 'to' day is included.
//       const dateFilter = {};

//       if (fromDate) {
//         dateFilter.$gte = fromDate;
//       }
//       if (toDate) {
//         const nextDay = new Date(toDate);
//         nextDay.setDate(nextDay.getDate() + 1);
//         dateFilter.$lt = nextDay;
//       }

//       filter.paymentDate = dateFilter;
//     }

//     const entries = await PaymentEntry.find(filter).sort({ paymentDate: 1 });
//     res.json(entries);
//   } catch (err) {
//     console.error("Get payment entries error:", err);
//     res.status(500).json({ error: "Server error fetching entries" });
//   }
// });

// GET /admin/payments?from=YYYY-MM-DD&to=YYYY-MM-DD&companyId=peels
router.get("/", async (req, res) => {
  try {
    const { from, to, companyId } = req.query;
    const filter = {};

    if (companyId) {
      filter.companyId = companyId;
    }

    if (from || to) {
      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;

      const dateFilter = {};
      if (fromDate) dateFilter.$gte = fromDate;
      if (toDate) {
        const nextDay = new Date(toDate);
        nextDay.setDate(nextDay.getDate() + 1); // include full 'to' day
        dateFilter.$lt = nextDay;
      }
      filter.paymentDate = dateFilter;
    }

    const entries = await PaymentEntry.find(filter).sort({ paymentDate: 1 });
    res.json(entries);
  } catch (err) {
    console.error("Get payment entries error:", err);
    res.status(500).json({ error: "Server error fetching entries" });
  }
});

// Reconcile report: totals by type and by date range
router.get("/reconcile", async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: "from and to dates are required" });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    // Aggregate totals by payment type
    const totalsByType = await PaymentEntry.aggregate([
      {
        $match: {
          paymentDate: { $gte: fromDate, $lte: toDate },
        },
      },
      {
        $group: {
          _id: "$paymentType",
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    let cashTotal = 0;
    let etransferTotal = 0;

    totalsByType.forEach((row) => {
      if (row._id === "cash") cashTotal = row.totalAmount;
      if (row._id === "etransfer") etransferTotal = row.totalAmount;
    });

    const overallTotal = cashTotal + etransferTotal;

    // Optional: breakdown by date
    const byDate = await PaymentEntry.aggregate([
      {
        $match: {
          paymentDate: { $gte: fromDate, $lte: toDate },
        },
      },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: "%Y-%m-%d", date: "$paymentDate" } },
            paymentType: "$paymentType",
          },
          totalAmount: { $sum: "$amount" },
        },
      },
      {
        $group: {
          _id: "$_id.day",
          totals: {
            $push: {
              paymentType: "$_id.paymentType",
              totalAmount: "$totalAmount",
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const dailyRows = byDate.map((dayRow) => {
      let cash = 0;
      let etransfer = 0;
      dayRow.totals.forEach((t) => {
        if (t.paymentType === "cash") cash = t.totalAmount;
        if (t.paymentType === "etransfer") etransfer = t.totalAmount;
      });
      return {
        date: dayRow._id,
        cash,
        etransfer,
        total: cash + etransfer,
      };
    });

    res.json({
      from: from,
      to: to,
      totals: {
        cash: cashTotal,
        etransfer: etransferTotal,
        overall: overallTotal,
      },
      daily: dailyRows,
    });
  } catch (err) {
    console.error("Reconcile error:", err);
    res.status(500).json({ error: "Server error generating reconcile report" });
  }
});


// GET /admin/payments/reconcile?from=...&to=...&companyId=peels
router.get("/payments/reconcile", async (req, res) => {
  try {
    const { from, to, companyId } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "from and to required" });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    const nextDay = new Date(toDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const match = {
      paymentDate: { $gte: fromDate, $lt: nextDay },
    };
    if (companyId) match.companyId = companyId;

    const totalsByType = await PaymentEntry.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$paymentType",
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    let cashTotal = 0;
    let etransferTotal = 0;
    totalsByType.forEach((row) => {
      if (row._id === "cash") cashTotal = row.totalAmount;
      if (row._id === "etransfer") etransferTotal = row.totalAmount;
    });

    const byDate = await PaymentEntry.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: "%Y-%m-%d", date: "$paymentDate" } },
            paymentType: "$paymentType",
          },
          totalAmount: { $sum: "$amount" },
        },
      },
      {
        $group: {
          _id: "$_id.day",
          totals: {
            $push: {
              paymentType: "$_id.paymentType",
              totalAmount: "$totalAmount",
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const daily = byDate.map((d) => {
      let cash = 0,
        etransfer = 0;
      d.totals.forEach((t) => {
        if (t.paymentType === "cash") cash = t.totalAmount;
        if (t.paymentType === "etransfer") etransfer = t.totalAmount;
      });
      return {
        date: d._id,
        cash,
        etransfer,
        total: cash + etransfer,
      };
    });

    res.json({
      from,
      to,
      companyId: companyId || null,
      totals: {
        cash: cashTotal,
        etransfer: etransferTotal,
        overall: cashTotal + etransferTotal,
      },
      daily,
    });
  } catch (err) {
    console.error("Reconcile error:", err);
    res.status(500).json({ error: "Server error generating reconcile report" });
  }
});



export default router;
