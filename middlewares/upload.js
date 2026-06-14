import multer from "multer";
import path from "path";
import fs from "fs";

const uploadCounters = {};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },

  filename: (req, file, cb) => {
    const reference = req.body.REFERENCE || "unknown";
    const safeRef = reference.replace(/[^a-zA-Z0-9_-]/g, "");

    if (!uploadCounters[safeRef]) {
      uploadCounters[safeRef] = 1;
    }

    const index = String(uploadCounters[safeRef]).padStart(2, "0");
    uploadCounters[safeRef]++;

    if (file.fieldname === "signature") {
      cb(null, `signature_${safeRef}${path.extname(file.originalname)}`);
      return;
    }

    cb(null, `image_${safeRef}_${index}${path.extname(file.originalname)}`);
  },
});

export const upload = multer({
  storage,
  limits: { files: 9 },
});

/* ================= RO IMAGE UPLOAD ================= */

/* ================= RO IMAGE UPLOAD ================= */

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
