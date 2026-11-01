import express from "express";
import {
  getCustomers,
  createCustomer,
  updateCustomer,
  updateCustomerStatus,
  createCustomerUser,
} from "../../controllers/admin/manage.customer.controller.js";
import { auth } from "../../middlewares/auth.js";

const router = express.Router();

// CUSTOMERS
router.get("/", auth, getCustomers);
router.post("/", auth, createCustomer);
router.post("/add-user", auth, createCustomerUser);
router.patch("/:id", auth, updateCustomer);
router.patch("/:id/status", auth, updateCustomerStatus);
// router.delete("/:id/hard", auth, allow(1, 10), deleteCustomerHard);

export default router;
