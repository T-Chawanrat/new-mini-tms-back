import express from "express";
import { getDriverDeliveries, getDriverDeliverySummary, completeDriverDeliveries } from "../../controllers/driver/driver.deliveries.controller.js";
import { auth } from "../../middlewares/auth.js";
import { assignStoredImageNames, uploadDriverDeliveryMedia } from "../../middlewares/upload.js";

const router = express.Router();

router.get("/", auth, getDriverDeliveries);
router.get("/summary", auth, getDriverDeliverySummary);
router.post("/complete", auth, uploadDriverDeliveryMedia.fields([{ name: "proof_images", maxCount: 8 }, { name: "sign_images", maxCount: 1 }]), assignStoredImageNames, completeDriverDeliveries);

export default router;
