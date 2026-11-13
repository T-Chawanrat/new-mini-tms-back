import express from "express";
import { customerAuth } from "../../middlewares/auth.js";
import { getOilPrices } from "../../controllers/admin/oil-price.controller.js";

const router = express.Router();

router.get("/", customerAuth, getOilPrices);

export default router;
