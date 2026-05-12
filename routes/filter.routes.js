import express from "express";
import {
  getRoles,
  getWarehouses,
  getZones,
  searchAddress,
} from "../controllers/filter.controller.js";

const router = express.Router();
router.get("/roles", getRoles);
router.get("/warehouses", getWarehouses);
router.get("/zones", getZones);
router.get("/address-search", searchAddress);

export default router;
