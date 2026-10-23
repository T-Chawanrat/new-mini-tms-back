import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const uploadsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../uploads");

export const saveMileageImages = async ({ connection, mileageId, driverId, type, files, now, createdFiles }) => {
  const relativeDirectory = path.posix.join("driver-mileage", String(mileageId), type.toLowerCase());
  const directory = path.join(uploadsDirectory, ...relativeDirectory.split("/"));
  await fs.mkdir(directory, { recursive: true });
  for (const file of files) {
    const absolutePath = path.join(directory, file.storedName);
    await fs.writeFile(absolutePath, file.buffer, { flag: "wx" });
    createdFiles.push(absolutePath);
    await connection.query(
      `INSERT INTO tm_driver_mileage_media (mileage_id, media_type, file_name, file_path, mime_type, file_size, created_by, created_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [mileageId, type, file.storedName, `/uploads/${relativeDirectory}/${file.storedName}`, file.mimetype, file.size, driverId, now],
    );
  }
};
