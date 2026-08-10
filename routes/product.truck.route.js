import express from "express";

import { getProductTrucks } from "../controllers/product.truck.controller.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

router.get("/", auth, getProductTrucks);

export default router;
