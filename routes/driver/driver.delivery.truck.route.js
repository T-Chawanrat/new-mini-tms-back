import express from "express";

import {
  closeAndGoDriverDeliveryTruck,
  createDriverDeliveryTruck,
  getDriverDeliveryTruck,
  getDriverDeliveryTruckOptions,
  getDriverDeliveryTruckProducts,
  loadDriverDeliveryTruckProduct,
  unloadDriverDeliveryTruckProduct,
} from "../../controllers/driver/driver.delivery.truck.controller.js";
import { auth } from "../../middlewares/auth.js";
import { assignStoredImageNames, uploadTruckClosePhoto } from "../../middlewares/upload.js";

const router = express.Router();

router.get("/options", auth, getDriverDeliveryTruckOptions);
router.post("/", auth, createDriverDeliveryTruck);
router.get("/:truckLoadId/products", auth, getDriverDeliveryTruckProducts);
router.post("/:truckLoadId/load-product", auth, loadDriverDeliveryTruckProduct);
router.post("/:truckLoadId/unload-product", auth, unloadDriverDeliveryTruckProduct);
router.get("/:truckLoadId", auth, getDriverDeliveryTruck);
router.patch("/:truckLoadId/close-and-go", auth, uploadTruckClosePhoto.single("photo"), assignStoredImageNames, closeAndGoDriverDeliveryTruck);

export default router;
