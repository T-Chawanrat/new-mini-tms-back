import express from "express";
import {
  getWarehouseVerifyList,
  scanWarehouseVerify,
} from "../controllers/scan.warehouse.controller.js";

const router = express.Router();

router.get("/warehouse", getWarehouseVerifyList);
router.post("/warehouse", scanWarehouseVerify);

export default router;
