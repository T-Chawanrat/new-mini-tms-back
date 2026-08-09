import express from "express";

import { createDcReceive, getDcReceiveSerials } from "../controllers/dc.receive.controller.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

router.get("/serials", auth, getDcReceiveSerials);
router.post("/", auth, createDcReceive);

export default router;
