import express from "express";
import { getShipments } from "../controllers/shipments.controller.js";
const router = express.Router();

router.get("/",  getShipments);

export default router;