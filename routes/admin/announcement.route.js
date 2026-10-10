import express from "express";
import multer from "multer";

import {
  getAnnouncements,
  getAnnouncementById,
  createAnnouncement,
  updateAnnouncement,
  toggleAnnouncementPinned,
  deleteAnnouncementMedia,
  deleteAnnouncement,
} from "../../controllers/admin/manage.announcement.controller.js";
import { auth } from "../../middlewares/auth.js";
import { assignStoredImageNames } from "../../middlewares/upload.js";
import { isSupportedImageMimeType } from "../../utils/file-url.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 4, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => callback(null, isSupportedImageMimeType(file.mimetype)),
});

// ANNOUNCEMENTS
router.get("/", auth, getAnnouncements);
router.get("/:announcementId", auth, getAnnouncementById);
router.post("/", auth, upload.array("images", 4), assignStoredImageNames, createAnnouncement);
router.put("/:announcementId", auth, upload.array("images", 4), assignStoredImageNames, updateAnnouncement);
router.patch("/:announcementId/pin", auth, toggleAnnouncementPinned);
router.delete("/:announcementId/media/:mediaId", auth, deleteAnnouncementMedia);
router.delete("/:announcementId", auth, deleteAnnouncement);

export default router;
