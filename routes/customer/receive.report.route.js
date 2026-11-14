// server/routes/admin/receive.report.route.js

import express from "express";
import {
  getReceiveReport,
  getReceiveReportPrint,
  getReceiveReportSummary,
} from "../../controllers/customer/receive.report.controller.js";
import { customerAuth as auth } from "../../middlewares/auth.js";

const router = express.Router();

router.get("/", auth, getReceiveReport);
router.get("/summary", auth, getReceiveReportSummary);
router.get("/print/:receiveBusinessId", auth, getReceiveReportPrint);

export default router;
