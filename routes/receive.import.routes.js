// server/routes/receive.import.routes.js

import express from "express";
import multer from "multer";
import { importReceivesFromExcel, validateReceiveImportRows } from "../controllers/receive.import.controller.js";
import { auth } from "../middlewares/auth.js";
import { allow } from "../middlewares/allow.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

router.post("/receives/import", auth, allow(1, 2, 3, 4, 5, 10), upload.single("file"), importReceivesFromExcel);
router.post("/receives/import/validate", auth, allow(1, 2, 3, 4, 5, 10), validateReceiveImportRows);

export default router;
