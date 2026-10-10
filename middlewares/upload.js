import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

import { getImageFileExtension } from "../utils/file-url.js";

const uploadedFiles = (files) => {
  if (Array.isArray(files)) return files;
  return Object.values(files || {}).flat();
};

export const assignStoredImageNames = (req, res, next) => {
  for (const file of uploadedFiles(req.files)) {
    const extension = getImageFileExtension(file.originalname, file.mimetype);
    if (!extension) return res.status(400).json({ success: false, message: "ไฟล์รูปภาพไม่ถูกต้อง" });
    file.storedName = `${randomUUID().replaceAll("-", "").slice(0, 16)}${extension}`;
  }
  return next();
};

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
