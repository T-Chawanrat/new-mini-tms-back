import express from "express";

import {
  getLabelPrintLogs,
  getProductTruckLogs,
  getProductWarehouseLogs,
  getReceiveCreateLogs,
  getReceiveImports,
} from "../../controllers/admin/log.controller.js";
import { auth } from "../../middlewares/auth.js";

const router = express.Router();

router.get("/label-print", auth, getLabelPrintLogs);
router.get("/product-trucks", auth, getProductTruckLogs);
router.get("/product-warehouses", auth, getProductWarehouseLogs);
router.get("/receive-create", auth, getReceiveCreateLogs);
router.get("/receive-imports", auth, getReceiveImports);

export default router;
