import express from "express";
import { createCustomerReceive } from "../controllers/customer.receive.controller.js";
import { auth } from "../middlewares/auth.js";
import { allow } from "../middlewares/allow.js";

const router = express.Router();

router.post(
  "/",
  auth,
  allow(2),
  createCustomerReceive
);

export default router;