import express from "express";
import { auth } from "../middlewares/auth.js";

import {
  importSTD,
  importVGT,
  importADV,
} from "../controllers/import.controller.js";

const router = express.Router();

router.post("/std", auth, importSTD);
router.post("/vgt", auth, importVGT);
router.post("/adv", auth, importADV);

export default router;
