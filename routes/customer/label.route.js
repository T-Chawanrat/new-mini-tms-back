import express from "express";

import { customerAuth as auth } from "../../middlewares/auth.js";
import {
  getLabelReceives,
  getLabelSerials,
  markLabelsPrinted,
  getLabelPrintHistory,
} from "../../controllers/customer/label.controller.js";

const router = express.Router();

router.get("/receives", getLabelReceives);
router.get("/serials", getLabelSerials);

router.post("/print", auth, markLabelsPrinted);
router.get("/:serialNo/history", getLabelPrintHistory);

export default router;

