import express from "express";

import { getMoveDcProducts, moveDcProduct } from "../controllers/move.dc.controller.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

router.get("/products", auth, getMoveDcProducts);
router.patch("/products", auth, moveDcProduct);

export default router;
