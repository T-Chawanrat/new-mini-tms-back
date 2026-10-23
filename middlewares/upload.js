import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

import { getImageFileExtension, isSupportedImageMimeType } from "../utils/file-url.js";

const uploadedFiles = (files) => {
  if (Array.isArray(files)) return files;
  return Object.values(files || {}).flat();
};

export const assignStoredImageNames = (req, res, next) => {
  const files = [...(req.file ? [req.file] : []), ...uploadedFiles(req.files)];

  for (const file of files) {
    const extension = getImageFileExtension(file.originalname, file.mimetype);
    if (!extension) return res.status(400).json({ success: false, message: "ไฟล์รูปภาพไม่ถูกต้อง" });
    file.storedName = `${randomUUID().replaceAll("-", "").slice(0, 16)}${extension}`;
  }
  return next();
};

export const uploadTruckClosePhoto = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 8 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (!getImageFileExtension(file.originalname, file.mimetype)) {
      return cb(new Error("only jpeg, png, webp allowed"));
    }

    cb(null, true);
  },
});

export const uploadDriverDeliveryMedia = multer({
  storage: multer.memoryStorage(),
  limits: { files: 9, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => isSupportedImageMimeType(file.mimetype)
    ? cb(null, true)
    : cb(new Error("รองรับเฉพาะไฟล์รูปภาพ JPG, PNG และ WebP")),
});

const roStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/ro";

    if (!fs.existsSync("uploads")) {
      fs.mkdirSync("uploads");
    }

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }

    cb(null, dir);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1e9);

    cb(null, `temp_ro_${timestamp}_${random}${ext}`);
  },
});

export const uploadROImages = multer({
  storage: roStorage,
  limits: {
    files: 5,
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("only jpeg, png, webp allowed"));
    }

    cb(null, true);
  },
});
