import express from "express";
import { getRoles, getWarehouses , getZones } from "../controllers/filter.controller.js";

const router = express.Router();
router.get("/roles",  getRoles);
router.get("/warehouses", getWarehouses);
router.get("/zones", getZones);


export default router;