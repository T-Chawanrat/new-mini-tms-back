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
} from "../controllers/filter.controller.js";

const router = express.Router();
router.get("/roles", getRoles);
router.get("/customers", getCustomers);
router.get("/warehouses", getWarehouses);
router.get("/zones", getZones);
router.get("/address-search", searchAddress);
router.get("/recipient-types", getRecipientTypes);
router.get("/vehicle-brands", getVehicleBrands);
router.get("/vehicle-types", getVehicleTypes);

export default router;
