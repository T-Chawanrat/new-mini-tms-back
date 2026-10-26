import express from "express";

import { auth } from "../../middlewares/auth.js";
import { assignStoredImageNames, uploadDriverDeliveryMedia } from "../../middlewares/upload.js";
import { createDriverDeliveryIssue, createDriverDeliveryIssueMessage, getDriverDeliveryIssueByReceive, getDriverDeliveryIssueMessages, getDriverDeliveryIssueReasons, getDriverDeliveryIssueThreads } from "../../controllers/driver/driver.delivery.issue.controller.js";

const router = express.Router();

router.post("/", auth, createDriverDeliveryIssue);
router.get("/", auth, getDriverDeliveryIssueThreads);
router.get("/reasons", auth, getDriverDeliveryIssueReasons);
router.get("/by-receive", auth, getDriverDeliveryIssueByReceive);
router.get("/:deliveryIssueId/messages", auth, getDriverDeliveryIssueMessages);
router.post("/:deliveryIssueId/messages", auth, uploadDriverDeliveryMedia.array("images", 4), assignStoredImageNames, createDriverDeliveryIssueMessage);

export default router;
