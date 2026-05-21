import express from "express";
import {
  getRoles,
  getCustomers,
  getWarehouses,
  searchAddress,
} from "../controllers/filter.controller.js";

const router = express.Router();

router.get("/customers", getCustomers);
router.get("/warehouses", getWarehouses);
router.get("/address-search", searchAddress);
router.get("/roles", getRoles);

export default router;
