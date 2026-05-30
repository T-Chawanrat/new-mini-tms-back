import express from "express";
import { createReceive, getReceiveShippers, getReceiveRecipients, getReceiveCustomers } from "../controllers/receive.controller.js";
import { auth } from "../middlewares/auth.js";
import { allow } from "../middlewares/allow.js";

const router = express.Router();

router.get("/options/customers", getReceiveCustomers);
router.get("/options/shippers/:customer_id", getReceiveShippers);
router.get("/options/recipients/:customer_id", getReceiveRecipients);
router.post("/", createReceive);

export default router;
