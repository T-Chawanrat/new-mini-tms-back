// server/routes/admin/receive.report.route.js

import express from "express";
import {
  getReceiveReport,
  getReceiveReportPrint,
  getReceiveReportSummary,
} from "../../controllers/admin/receive.report.controller.js";

const router = express.Router();

router.get("/", getReceiveReport);
router.get("/summary", getReceiveReportSummary);
router.get("/print/:receiveBusinessId", getReceiveReportPrint);

export default router;
