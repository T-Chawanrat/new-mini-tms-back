// server/routes/truckLoadRoutes.js

import express from "express";

import {
  createTruckLoad,
  closeAndGoTruckLoad,
  deleteTruckLoad,
  getTruckLoadPrint,
  getTruckLoadById,
  getTruckLoadDrivers,
  getTruckLoadDummyUsers,
  getTruckLoadProducts,
  getTruckLoads,
  loadTruckProduct,
  unloadTruckProduct,
} from "../controllers/truck.controller.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

router.get("/get-truck", auth, getTruckLoads);
router.get("/drivers", auth, getTruckLoadDrivers);
router.get("/dummy-users", auth, getTruckLoadDummyUsers);
router.get("/get-truck/:truckLoadId", auth, getTruckLoadById);
router.get("/:truckLoadId/print", auth, getTruckLoadPrint);
router.get("/:truckLoadId/products", auth, getTruckLoadProducts);
router.post("/:truckLoadId/load-product", auth, loadTruckProduct);
router.post("/:truckLoadId/unload-product", auth, unloadTruckProduct);
router.patch("/:truckLoadId/close-and-go", auth, closeAndGoTruckLoad);
router.patch("/:truckLoadId/delete", auth, deleteTruckLoad);
router.post("/create-truck", auth, createTruckLoad);

export default router;
