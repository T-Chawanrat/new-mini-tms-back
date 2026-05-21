import express from "express";
import {
  getCustomers,
  createCustomer,
  updateCustomer,
  updateCustomerStatus,
  deleteCustomer,
  deleteCustomerHard,
  createCustomerUser,
} from "../controllers/manage.customer.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

// CUSTOMERS
router.get("/customers", auth, getCustomers);
router.post("/customers", auth, allow(1, 3, 4, 5, 10), createCustomer);
router.post("/customer-users", auth, allow(1, 10), createCustomerUser);
router.patch("/customers/:id", auth, allow(1, 3, 4, 5, 10), updateCustomer);
router.patch("/customers/:id/status", auth, allow(1, 10, 11), updateCustomerStatus);
router.delete("/customers/:id", auth, allow(1, 3, 4, 5, 10), deleteCustomer);
router.delete("/customers/:id/hard", auth, allow(1, 10), deleteCustomerHard);

export default router;
