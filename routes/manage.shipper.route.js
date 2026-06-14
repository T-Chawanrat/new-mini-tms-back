import express from "express";
import {
  getShippers,
  createShipper,
  updateShipper,
  updateShipperStatus,
  createShipperROCode,
  uploadShipperROImages,
  getShipperROCodes,
  updateShipperROCode,
  deleteShipperROCode,
} from "../controllers/manage.shipper.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";
import { uploadROImages } from "../middlewares/upload.js";

const router = express.Router();

router.get("/:customer_id", auth, getShippers);
router.post("/:customer_id", auth, allow(1, 2, 3, 4, 5, 10, 11), createShipper);
router.patch("/:customer_id/:id", auth, allow(1, 2, 3, 4, 5, 10, 11), updateShipper);
router.patch("/:customerId/:shipperId/status", auth, allow(1, 2, 10, 11), updateShipperStatus);
router.post("/:customer_id/:shipper_id/ro-codes", auth, allow(1, 2, 3, 4, 5, 10, 11), createShipperROCode);

router.post(
  "/:customer_id/:shipper_id/ro-codes/:ro_code_id/images",
  auth,
  allow(1, 2, 3, 4, 5, 10, 11),
  uploadROImages.array("images", 5),
  uploadShipperROImages,
);

router.get("/:customer_id/:shipper_id/ro-codes", auth, allow(1, 2, 3, 4, 5, 10, 11), getShipperROCodes);

router.patch("/:customer_id/:shipper_id/ro-codes/:ro_code_id", auth, allow(1, 2, 3, 4, 5, 10, 11), updateShipperROCode);

router.delete("/:customer_id/:shipper_id/ro-codes/:ro_code_id", auth, allow(1, 2, 3, 4, 5, 10, 11), deleteShipperROCode);

export default router;
