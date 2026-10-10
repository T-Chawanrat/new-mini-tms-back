import express from "express";
import { auth } from "../../middlewares/auth.js";
import { getOilPrices } from "../../controllers/admin/oil-price.controller.js";

const router = express.Router();

router.get("/", auth, getOilPrices);

export default router;
