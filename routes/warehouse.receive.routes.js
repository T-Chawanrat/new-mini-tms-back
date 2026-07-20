import express from "express";

import {
  getWarehouseReceiveSerials,
  // receiveSerialToWarehouse,
} from "../controllers/warehouse.receive.controller.js";

const router = express.Router();

router.get(
  "/serials",
  getWarehouseReceiveSerials,
);

// router.post(
//   "/receive",
//   receiveSerialToWarehouse,
// );

export default router;