import express from "express";

import {
  getMoveDtProducts,
  getMoveDtSourceTrucks,
  getMoveDtTargetTrucks,
  moveDtProducts,
} from "../controllers/move.dt.controller.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

router.get("/source-trucks", auth, getMoveDtSourceTrucks);
router.get("/target-trucks", auth, getMoveDtTargetTrucks);
router.get("/:truckLoadId/products", auth, getMoveDtProducts);
router.patch("/products", auth, moveDtProducts);

export default router;
