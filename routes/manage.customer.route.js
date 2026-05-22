import express from "express";
import {
  getCustomers,
  createCustomer,
  updateCustomer,
  updateCustomerStatus,
  deleteCustomer,
  createCustomerUser,
} from "../controllers/manage.customer.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

// CUSTOMERS
router.get("/", auth, getCustomers);
router.post("/", auth, allow(1, 3, 4, 5, 10), createCustomer);
router.post("/add-user", auth, allow(1, 10), createCustomerUser);
router.patch("/:id", auth, allow(1, 3, 4, 5, 10), updateCustomer);
router.patch("/:id/status", auth, allow(1, 10, 11), updateCustomerStatus);
router.delete("/:id", auth, allow(1, 3, 4, 5, 10), deleteCustomer);
// router.delete("/:id/hard", auth, allow(1, 10), deleteCustomerHard);

export default router;
