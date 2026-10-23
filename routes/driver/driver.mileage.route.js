import express from "express";
import { getCurrentMileage, openMileage, closeMileage } from "../../controllers/driver/driver.mileage.controller.js";
import { auth } from "../../middlewares/auth.js";
import { assignStoredImageNames, uploadDriverDeliveryMedia } from "../../middlewares/upload.js";

const router = express.Router();

router.get("/current", auth, getCurrentMileage);
router.post("/open", auth, uploadDriverDeliveryMedia.array("images", 2), assignStoredImageNames, openMileage);
router.post("/:mileageId/close", auth, uploadDriverDeliveryMedia.array("images", 5), assignStoredImageNames, closeMileage);

export default router;
