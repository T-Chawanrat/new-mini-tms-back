import express from "express";
import multer from "multer";
import { addCompletedDeliveryCloseMedia, deleteCompletedDeliveryCloseMedia, searchCompletedDeliveryCloseMedia } from "../controllers/delivery.close.media.controller.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 12, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});

router.get("/search", auth, searchCompletedDeliveryCloseMedia);
router.post("/", auth, upload.fields([{ name: "proof_images", maxCount: 8 }, { name: "sign_images", maxCount: 4 }]), addCompletedDeliveryCloseMedia);
router.delete("/:mediaId", auth, deleteCompletedDeliveryCloseMedia);

export default router;
