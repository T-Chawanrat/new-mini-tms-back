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
} from "../../controllers/admin/manage.shipper.controller.js";
import { auth } from "../../middlewares/auth.js";
import { uploadROImages } from "../../middlewares/upload.js";

const router = express.Router();

router.get("/:customer_id", auth, getShippers);
router.post("/:customer_id", auth, createShipper);
router.patch("/:customer_id/:id", auth, updateShipper);
router.patch("/:customerId/:shipperId/status", auth, updateShipperStatus);
router.post("/:customer_id/:shipper_id/ro-codes", auth, createShipperROCode);

router.post(
  "/:customer_id/:shipper_id/ro-codes/:ro_code_id/images",
  auth,
  uploadROImages.array("images", 5),
  uploadShipperROImages,
);

router.get("/:customer_id/:shipper_id/ro-codes", auth, getShipperROCodes);

router.patch("/:customer_id/:shipper_id/ro-codes/:ro_code_id", auth, updateShipperROCode);

router.delete("/:customer_id/:shipper_id/ro-codes/:ro_code_id", auth, deleteShipperROCode);

export default router;
