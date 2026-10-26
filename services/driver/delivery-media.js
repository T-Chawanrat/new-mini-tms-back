import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const uploadsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../uploads");

export const saveDriverDeliveryMedia = async ({ connection, bills, proof, signature, createdFiles, driverId, now }) => {
  for (const bill of bills) {
      // Serialize partial closes of the same bill before checking its media limit.
      await connection.query(
        `SELECT serial_id FROM tm_receive_serials
         WHERE receive_business_id <=> ? AND receive_walkin_id <=> ? FOR UPDATE`,
        [bill.receive_business_id, bill.receive_walkin_id],
      );
      const sourceId = bill.receive_business_id ?? bill.receive_walkin_id;
      const sourceType = bill.receive_business_id !== null && bill.receive_business_id !== undefined ? "business" : "walkin";
      if (!sourceId) {
        const error = new Error("เลขบิลไม่ถูกต้อง");
        error.status = 400;
        throw error;
      }
      const folder = `${sourceType}-${sourceId}`;
      const [existing] = await connection.query(
        `SELECT media_type FROM tm_delivery_close_media
         WHERE receive_business_id <=> ? AND receive_walkin_id <=> ? AND is_deleted = 0 FOR UPDATE`,
        [bill.receive_business_id, bill.receive_walkin_id],
      );
      const proofCount = existing.filter((row) => row.media_type === "PROOF_IMAGE").length;
      const signCount = existing.filter((row) => row.media_type === "SIGNATURE_IMAGE").length;
      if (proofCount + proof.length < 1 || signCount + signature.length < 1 || proofCount + proof.length > 8 || signCount + signature.length > 4) {
        const error = new Error(`บิล ${bill.receive_code} ต้องมีรูปและลายเซ็น และรูปต้องไม่เกิน 8 รูป ลายเซ็นไม่เกิน 4 รูป`);
        error.status = 400;
        throw error;
      }
      for (const group of [
        { type: "PROOF_IMAGE", folder: "proof", files: proof },
        { type: "SIGNATURE_IMAGE", folder: "signature", files: signature },
      ]) {
        for (const file of group.files) {
          const relativeDirectory = path.posix.join("delivery-closes", folder, group.folder);
          const directory = path.join(uploadsDirectory, ...relativeDirectory.split("/"));
          const absolutePath = path.join(directory, file.storedName);
          await fs.mkdir(directory, { recursive: true });
          await fs.writeFile(absolutePath, file.buffer, { flag: "wx" });
          createdFiles.push(absolutePath);
          const name = String(file.originalname || file.storedName)
            .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")
            .slice(0, 255);
          await connection.query(
            `INSERT INTO tm_delivery_close_media (receive_business_id, receive_walkin_id, receive_code, media_type, file_name, file_path, mime_type, file_size, is_deleted, created_by, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            [
              bill.receive_business_id,
              bill.receive_walkin_id,
              bill.receive_code,
              group.type,
              name,
              `/uploads/${relativeDirectory}/${file.storedName}`,
              file.mimetype,
              file.size,
              driverId,
              now,
            ],
          );
        }
      }
  }
};

