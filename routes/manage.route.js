import express from "express";
import {
  getUsers,
  createUser,
  updateUser,
  deleteUserHard,
  getVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getCustomers,
  createCustomer,
  updateCustomer,
  updateCustomerStatus,
  deleteCustomer,
  deleteCustomerHard,
  createCustomerUser,
  getShippers,
  createShipper,
  updateShipper,
  updateShipperStatus,
  getRecipients,
  createRecipient,
  createRecipientDetail,
  updateRecipient,
  updateRecipientDetailStatus,
} from "../controllers/manage.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

// USERS
router.get("/users", auth, getUsers);
router.post("/users", auth, allow(1, 9, 10), createUser);
router.put("/users/:id", auth, allow(1, 9, 10, 11), updateUser);
router.delete("/users/:id/hard", auth, allow(1, 10, 11), deleteUserHard);

// VEHICLES
router.get("/vehicles", auth, getVehicles);
router.post("/vehicles", auth, allow(1, 3, 4, 5, 10), createVehicle);
router.patch("/vehicles/:id", auth, allow(1, 3, 4, 5, 10), updateVehicle);
router.delete("/vehicles/:id", auth, allow(1, 3, 4, 5, 10), deleteVehicle);

// CUSTOMERS
router.get("/customers", auth, getCustomers);
router.post("/customers", auth, allow(1, 3, 4, 5, 10), createCustomer);
router.post("/customer-users", auth, allow(1, 10), createCustomerUser);
router.patch("/customers/:id", auth, allow(1, 3, 4, 5, 10), updateCustomer);
router.patch("/customers/:id/status", auth, allow(1, 10, 11), updateCustomerStatus);
router.delete("/customers/:id", auth, allow(1, 3, 4, 5, 10), deleteCustomer);
router.delete("/customers/:id/hard", auth, allow(1, 10), deleteCustomerHard);

// SHIPPERS
router.get("/customers/:customer_id/shippers", auth, getShippers);
router.post("/customers/:customer_id/shippers", auth, allow(1, 2, 3, 4, 5, 10, 11), createShipper);
router.patch("/customers/:customer_id/shippers/:id", auth, allow(1, 2, 3, 4, 5, 10, 11), updateShipper);
router.patch("/customers/:customerId/shippers/:shipperId/status", auth, allow(1, 2, 10, 11), updateShipperStatus);

// RECIPIENTS
router.get("/customers/:customer_id/recipients", auth, getRecipients);
router.post("/customers/:customer_id/recipients", auth, allow(1, 2, 3, 4, 5, 10, 11), createRecipient);
router.post("/customers/:customer_id/recipients/:id/details", auth, allow(1, 2, 3, 4, 5, 10, 11), createRecipientDetail);
router.patch("/customers/:customer_id/recipients/:id", auth, allow(1, 2, 3, 4, 5, 10, 11), updateRecipient);
router.patch(
  "/customers/:customerId/recipients/:recipientId/details/:detailId/status",
  auth,
  allow(1, 2, 3, 4, 5, 10, 11),
  updateRecipientDetailStatus,
);

export default router;
