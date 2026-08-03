import express from "express";
import {
  getRoles,
  getCustomers,
  getWarehouses,
  getZones,
  searchAddress,
  getRecipientTypes,
  getVehicleBrands,
  getVehicleTypes,
  getReceivePayments,
  getReceiveDeliveryTypes,
  getDriverUsers,
  getActiveVehicles,
} from "../controllers/filter.controller.js";

const router = express.Router();
router.get("/roles", getRoles);
router.get("/driver-users", getDriverUsers);
router.get("/vehicles", getActiveVehicles);
router.get("/customers", getCustomers);
router.get("/warehouses", getWarehouses);
router.get("/zones", getZones);
router.get("/address-search", searchAddress);
router.get("/recipient-types", getRecipientTypes);
router.get("/vehicle-brands", getVehicleBrands);
router.get("/vehicle-types", getVehicleTypes);
router.get("/payments", getReceivePayments);
router.get("/delivery-types", getReceiveDeliveryTypes);

export default router;
