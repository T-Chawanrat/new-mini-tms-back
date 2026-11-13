// server/routes/admin/receive.import.routes.js

import express from "express";
import multer from "multer";
import { importReceivesFromExcel, validateReceiveImportRows } from "../../controllers/customer/receive.import.controller.js";
import { customerAuth as auth } from "../../middlewares/auth.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

router.post("/receives/import", auth, upload.single("file"), importReceivesFromExcel);
router.post("/receives/import/validate", auth, validateReceiveImportRows);

export default router;
