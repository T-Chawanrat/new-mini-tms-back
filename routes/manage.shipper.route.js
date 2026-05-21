import express from "express";
import { getShippers, createShipper, updateShipper, updateShipperStatus } from "../controllers/manage.shipper.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

// SHIPPERS
router.get("/customers/:customer_id/shippers", auth, getShippers);
router.post("/customers/:customer_id/shippers", auth, allow(1, 2, 3, 4, 5, 10, 11), createShipper);
router.patch("/customers/:customer_id/shippers/:id", auth, allow(1, 2, 3, 4, 5, 10, 11), updateShipper);
router.patch("/customers/:customerId/shippers/:shipperId/status", auth, allow(1, 2, 10, 11), updateShipperStatus);

export default router;
