import express from "express";
import {
  getRecipients,
  createRecipient,
  createRecipientDetail,
  updateRecipient,
  updateRecipientDetailStatus,
} from "../controllers/manage.recipient.controller.js";
import { allow } from "../middlewares/allow.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

// RECIPIENTS
router.get("/:customer_id", auth, getRecipients);
router.post("/:customer_id", auth, allow(1, 2, 3, 4, 5, 10, 11), createRecipient);
router.post("/:customer_id/:id/details", auth, allow(1, 2, 3, 4, 5, 10, 11), createRecipientDetail);
router.patch("/:customerId/:recipientId/details/:detailId/status", auth, allow(1, 2, 3, 4, 5, 10, 11), updateRecipientDetailStatus);
router.patch("/:customer_id/:id", auth, allow(1, 2, 3, 4, 5, 10, 11), updateRecipient);

export default router;
