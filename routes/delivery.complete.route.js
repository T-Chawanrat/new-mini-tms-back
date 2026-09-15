import express from "express";
import multer from "multer";

import { getDeliveryCompletes, saveDeliveryCompleteStatuses } from "../controllers/delivery.complete.controller.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();
const uploadDeliveryMedia = multer({
  storage: multer.memoryStorage(),
  limits: { files: 25, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(new Error("รองรับเฉพาะไฟล์รูปภาพ JPG, PNG และ WebP"));
  },
});

router.get("/", auth, getDeliveryCompletes);
router.post(
  "/:truckLoadId/statuses",
  auth,
  uploadDeliveryMedia.fields([
    { name: "proof_images", maxCount: 8 },
    { name: "sign_images", maxCount: 1 },
    { name: "reschedule_images", maxCount: 8 },
    { name: "return_images", maxCount: 8 },
  ]),
  saveDeliveryCompleteStatuses,
);

export default router;
