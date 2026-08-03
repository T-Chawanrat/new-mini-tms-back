// server/routes/truckLoadRoutes.js

import express from "express";

import {
  createTruckLoad,
  getTruckLoadById,
  getTruckLoadDrivers,
  getTruckLoadProducts,
  getTruckLoads,
} from "../controllers/truck.controller.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

router.get("/get-truck", auth, getTruckLoads);
router.get("/drivers", auth, getTruckLoadDrivers);
router.get("/get-truck/:truckLoadId", auth, getTruckLoadById);
router.get("/:truckLoadId/products", auth, getTruckLoadProducts);
router.post("/create-truck", auth, createTruckLoad);

export default router;
