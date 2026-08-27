import express from "express";

import {
  getMoveTkProducts,
  getMoveTkSourceTrucks,
  getMoveTkTargetTrucks,
  moveTkProducts,
} from "../controllers/move.tk.controller.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

router.get("/source-trucks", auth, getMoveTkSourceTrucks);
router.get("/target-trucks", auth, getMoveTkTargetTrucks);
router.get("/:truckLoadId/products", auth, getMoveTkProducts);
router.patch("/products", auth, moveTkProducts);

export default router;
