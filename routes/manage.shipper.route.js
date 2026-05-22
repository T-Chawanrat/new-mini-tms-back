import express from "express";
import { getShippers, createShipper, updateShipper, updateShipperStatus } from "../controllers/manage.shipper.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

router.get("/:customer_id", auth, getShippers);
router.post("/:customer_id", auth, allow(1, 2, 3, 4, 5, 10, 11), createShipper);
router.patch("/:customer_id/:id", auth, allow(1, 2, 3, 4, 5, 10, 11), updateShipper);
router.patch("/:customerId/:shipperId/status", auth, allow(1, 2, 10, 11), updateShipperStatus);

export default router;
