import express from "express";
import {
  getRoles,
  getCustomers,
  getWarehouses,
  searchAddress,
  getDropdownWarehouse,
} from "../controllers/filter.controller.js";

const router = express.Router();

router.get("/customers", getCustomers);
router.get("/select-warehouse", getDropdownWarehouse);
router.get("/warehouses", getWarehouses);
router.get("/address-search", searchAddress);
router.get("/roles", getRoles);

export default router;
