import express from "express";

import { getDriverFailedProducts, returnDriverProducts } from "../../controllers/driver/driver.return.controller.js";
import { auth } from "../../middlewares/auth.js";

const router = express.Router();

router.get("/failed", auth, getDriverFailedProducts);
router.post("/", auth, returnDriverProducts);

export default router;
