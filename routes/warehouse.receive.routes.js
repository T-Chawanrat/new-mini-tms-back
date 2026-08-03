import express from "express";

import { auth } from "../middlewares/auth.js";

import {
  getWarehouseReceiveSerials,
  createWarehouseReceive,
} from "../controllers/warehouse.receive.controller.js";

const router = express.Router();

router.get("/serials", auth, getWarehouseReceiveSerials);
router.post("/", auth, createWarehouseReceive);

export default router;