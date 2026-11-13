import express from "express";
import { customerAuth } from "../../middlewares/auth.js";
import { getAnnouncements , getAnnouncementById } from "../../controllers/admin/manage.announcement.controller.js";

const router = express.Router();

router.get("/", customerAuth, getAnnouncements);
router.get("/:announcementId", customerAuth, getAnnouncementById);

export default router;
