import express from "express";

import { getProductWarehouses } from "../../controllers/admin/product.warehouse.controller.js";
import { auth } from "../../middlewares/auth.js";

const router = express.Router();

router.get("/", auth, getProductWarehouses);

export default router;
