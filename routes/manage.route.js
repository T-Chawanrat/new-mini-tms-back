import express from "express";
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  deleteUserHard,
  getVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  deleteCustomerHard,
  createCustomerUser,
} from "../controllers/manage.controller.js";

import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js"; // 🔥 เพิ่ม

const router = express.Router();

// USERS
router.get("/users", auth, getUsers);
router.post("/users", auth, allow(1, 9, 10), createUser);
router.put("/users/:id", auth, allow(1, 9, 10), updateUser);
router.delete("/users/:id", auth, allow(1, 9, 10), deleteUser);
router.delete("/users/:id/hard", auth, allow(1, 10), deleteUserHard);

// VEHICLES
router.get("/vehicles", auth, getVehicles);
router.post("/vehicles", auth, allow(1, 3, 4, 5, 10), createVehicle);
router.patch("/vehicles/:id", auth, allow(1, 3, 4, 5, 10), updateVehicle);
router.delete("/vehicles/:id", auth, allow(1, 3, 4, 5, 10), deleteVehicle);

// CUSTOMERS
router.get("/customers", auth, getCustomers);
router.post("/customers", auth, allow(1, 3, 4, 5, 10), createCustomer);
router.patch("/customers/:id", auth, allow(1, 3, 4, 5, 10), updateCustomer);
router.delete("/customers/:id", auth, allow(1, 3, 4, 5, 10), deleteCustomer);
router.delete("/customers/:id/hard", auth, allow(1, 10), deleteCustomerHard);

// CUSTOMER USERS
router.post("/customer-users", auth, allow(1, 10), createCustomerUser);

export default router;