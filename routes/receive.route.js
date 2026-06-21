import express from "express";
import {
  getReceiveShippers,
  getReceiveRecipients,
  getReceiveCustomers,
  getReceivePackages,
  getShipperROCode,
  getRecipientCalendar,
} from "../controllers/receive.controller.js";
import { auth } from "../middlewares/auth.js";
import { allow } from "../middlewares/allow.js";

const router = express.Router();

router.get("/options/customers", getReceiveCustomers);
router.get("/options/shippers/:customer_id", getReceiveShippers);
router.get("/options/recipients/:customer_id", getReceiveRecipients);
router.get("/options/packages/:customer_id", getReceivePackages);
router.get("/options/ro-codes/:customer_id/:shipper_id", getShipperROCode);
router.get("/options/recipient-calendar/:customer_id/:recipient_detail_id", getRecipientCalendar);

export default router;
