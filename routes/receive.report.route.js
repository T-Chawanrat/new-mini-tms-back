// server/routes/receive.report.route.js

import express from "express";
import {
  getReceiveReport,
  getReceiveReportSummary,
} from "../controllers/receive.report.controller.js";

const router = express.Router();

router.get("/", getReceiveReport);
router.get("/summary", getReceiveReportSummary);

export default router;