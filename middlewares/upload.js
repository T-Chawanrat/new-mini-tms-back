// import multer from "multer";
// import path from "path";
// import fs from "fs";

// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     const dir = "uploads";
//     if (!fs.existsSync(dir)) fs.mkdirSync(dir);
//     cb(null, dir);
//   },
//   filename: (req, file, cb) => {
//     if (file.fieldname === "signature") {
//       cb(null, "signature_" + Date.now() + path.extname(file.originalname));
//     } else {
//       cb(null, "image_" + Date.now() + path.extname(file.originalname));
//     }
//   },
// });

// export const upload = multer({
//   storage,
//   limits: { files: 9 }
// });

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
