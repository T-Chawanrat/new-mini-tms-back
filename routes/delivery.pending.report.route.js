import express from "express";

import {
  getDeliveryReportByDt,
  getDeliveryReportByReceive,
  getDeliveryReportBySn,
} from "../controllers/delivery.pending.report.controller.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

router.get("/dt", auth, getDeliveryReportByDt);
router.get("/receive", auth, getDeliveryReportByReceive);
router.get("/sn", auth, getDeliveryReportBySn);

export default router;
