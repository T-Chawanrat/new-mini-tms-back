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

const router = express.Router();

// USERS
router.get("/users", getUsers);
router.post("/users", allow(1, 9, 10), createUser);
router.put("/users/:id", allow(1, 9, 10), updateUser);
router.delete("/users/:id", allow(1, 9, 10), deleteUser);
router.delete("/users/:id/hard", allow(1, 10), deleteUserHard);

// VEHICLES
router.get("/vehicles", getVehicles);
router.post("/vehicles", allow(1, 3, 4, 5, 10), createVehicle);
router.patch("/vehicles/:id", allow(1, 3, 4, 5, 10), updateVehicle);
router.delete("/vehicles/:id", allow(1, 3, 4, 5, 10), deleteVehicle);

router.get("/customers", getCustomers);
router.post("/customers", allow(1, 3, 4, 5, 10), createCustomer);
router.patch("/customers/:id", allow(1, 3, 4, 5, 10), updateCustomer);
router.delete("/customers/:id", allow(1, 3, 4, 5, 10), deleteCustomer);
router.delete("/customers/:id/hard", allow(1, 10), deleteCustomerHard);
router.post("/customer-users", allow(1, 10), createCustomerUser);

export default router;
