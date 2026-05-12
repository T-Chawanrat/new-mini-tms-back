// src/services/masterData.service.js

import db from "../config/db.js";

export const checkCustomerExists = async (customer_id) => {
  const [rows] = await db.query(
    `
    SELECT id
    FROM mm_customers
    WHERE id = ?
    LIMIT 1
    `,
    [customer_id],
  );

  return rows.length > 0;
};

export const checkCustomerActive = async (customer_id) => {
  const [rows] = await db.query(
    `
    SELECT id
    FROM mm_customers
    WHERE id = ?
      AND is_active = 1
    LIMIT 1
    `,
    [customer_id],
  );

  return rows.length > 0;
};

export const checkRecipientActive = async (recipient_id) => {
  const [rows] = await db.query(
    `
    SELECT recipient_id
    FROM mm_recipients
    WHERE recipient_id = ?
      AND is_deleted = 0
    LIMIT 1
    `,
    [recipient_id],
  );

  return rows.length > 0;
};

export const checkShipperActive = async (shipper_id) => {
  const [rows] = await db.query(
    `
    SELECT shipper_id
    FROM mm_shippers
    WHERE shipper_id = ?
      AND is_deleted = 0
    LIMIT 1
    `,
    [shipper_id],
  );

  return rows.length > 0;
};