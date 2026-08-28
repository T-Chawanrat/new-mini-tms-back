import express from "express";

import {
  createDeliveryTruck,
  deleteDeliveryTruck,
  getDeliveryTruckById,
  getDeliveryTruckOptions,
  getDeliveryTruckPrint,
  getDeliveryTruckProducts,
  getDeliveryTrucks,
  loadDeliveryTruckProduct,
  unloadDeliveryTruckProduct,
} from "../controllers/delivery.truck.controller.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

router.get("/options", auth, getDeliveryTruckOptions);
router.get("/", auth, getDeliveryTrucks);
router.get("/:truckLoadId/print", auth, getDeliveryTruckPrint);
router.get("/:truckLoadId/products", auth, getDeliveryTruckProducts);
router.get("/:truckLoadId", auth, getDeliveryTruckById);
router.post("/:truckLoadId/load-product", auth, loadDeliveryTruckProduct);
router.post("/:truckLoadId/unload-product", auth, unloadDeliveryTruckProduct);
router.patch("/:truckLoadId/delete", auth, deleteDeliveryTruck);
router.post("/", auth, createDeliveryTruck);

export default router;
