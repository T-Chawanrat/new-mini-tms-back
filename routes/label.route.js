import express from "express";

import {
  getLabelReceives,
  getLabelSerials,
  markLabelsPrinted,
  getLabelPrintHistory,
} from "../controllers/label.controller.js";

const router = express.Router();

router.get("/receives", getLabelReceives);
router.get("/serials", getLabelSerials);

router.post("/print", markLabelsPrinted);
router.get("/:serialNo/history", getLabelPrintHistory);

export default router;

