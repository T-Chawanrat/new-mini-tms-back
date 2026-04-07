import express from "express";
import labelController from "../controllers/labelController.js";

const router = express.Router();

router.get("/print-labels", labelController.getPrintLabels);
router.get("/reprint-labels", labelController.getReprintLabels);

export default router;
