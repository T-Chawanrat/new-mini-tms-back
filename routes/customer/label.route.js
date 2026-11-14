import express from "express";

import { customerAuth as auth } from "../../middlewares/auth.js";
import {
  getLabelReceives,
  getLabelSerials,
  markLabelsPrinted,
  getLabelPrintHistory,
} from "../../controllers/customer/label.controller.js";

const router = express.Router();

router.get("/receives", auth, getLabelReceives);
router.get("/serials", auth, getLabelSerials);

router.post("/print", auth, markLabelsPrinted);
router.get("/:serialNo/history", auth, getLabelPrintHistory);

export default router;

