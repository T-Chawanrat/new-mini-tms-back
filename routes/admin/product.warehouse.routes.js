import express from "express";

import {
  getProductWarehouseSerialList,
  getProductWarehouseSerials,
  getProductWarehouses,
} from "../../controllers/admin/product.warehouse.controller.js";
import { auth } from "../../middlewares/auth.js";

const router = express.Router();

router.get("/", auth, getProductWarehouses);
router.get("/serials", auth, getProductWarehouseSerialList);
router.get("/:receiveCode/serials", auth, getProductWarehouseSerials);

export default router;
