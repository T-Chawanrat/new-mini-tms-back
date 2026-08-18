import { randomUUID } from "crypto";
import { cleanCode } from "./cleanText.js";

const createActiveSerialError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  error.status = 400;
  return error;
};

export const createActiveProductSerialOrThrow = async ({ conn, serialNo, now, createError = createActiveSerialError }) => {
  const cleanSerialNo = cleanCode(serialNo);

  if (!cleanSerialNo) {
    throw createError("ไม่พบ SERIAL_NO");
  }

  const [existingRows] = await conn.query(
    `
      SELECT serial_id, serial_no
      FROM tm_product_actived
      WHERE serial_no = ?
      LIMIT 1
      FOR UPDATE
    `,
    [cleanSerialNo],
  );

  if (existingRows.length > 0) {
    throw createError(`SERIAL_NO ${cleanSerialNo} ยังมีงานค้างอยู่`);
  }

  const serialId = randomUUID();

  try {
    await conn.query(
      `
        INSERT INTO tm_product_actived (serial_id, serial_no, created_date)
        VALUES (?, ?, ?)
      `,
      [serialId, cleanSerialNo, now],
    );

    return { serial_id: serialId, serial_no: cleanSerialNo };
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      throw createError(`SERIAL_NO ${cleanSerialNo} ยังมีงานค้างอยู่`);
    }

    throw error;
  }
};
