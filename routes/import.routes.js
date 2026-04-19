// routes/import.routes.js

import express from "express";
import {
  importSTD,
  importVGT,
  importADV,
} from "../controllers/import.controller.js";

const router = express.Router();

router.post("/std", importSTD);
router.post("/vgt", importVGT);
router.post("/adv", importADV);

export default router;