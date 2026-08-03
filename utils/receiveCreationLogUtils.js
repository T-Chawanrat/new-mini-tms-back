import { buildInsertSql, cleanDbText, toNumberOrNull, toNumberOrZero } from "./cleanText.js";

const RECEIVE_CREATION_SOURCE_TYPES = new Set(["WEB", "IMPORT"]);

export const insertReceiveCreationLog = async ({
  conn,
  receiveId,
  receiveCode,
  customerId,
  sourceType,
  sourceImportId = null,
  detailCount = 0,
  itemCount = 0,
  createdBy,
}) => {
  const cleanReceiveId = toNumberOrNull(receiveId);
  const cleanCreatedBy = toNumberOrNull(createdBy);
  const cleanSourceType = cleanDbText(sourceType)?.toUpperCase();

  if (!cleanReceiveId) {
    throw new Error("receive_id required for logs_receive_create");
  }

  if (!cleanCreatedBy) {
    throw new Error("created_by required for logs_receive_create");
  }

  if (!RECEIVE_CREATION_SOURCE_TYPES.has(cleanSourceType)) {
    throw new Error("source_type must be WEB or IMPORT");
  }

  const [userRows] = await conn.query(
    `
      SELECT
        id,
        username,
        first_name,
        last_name,
        warehouse_id
      FROM um_users
      WHERE id = ?
      LIMIT 1
    `,
    [cleanCreatedBy],
  );

  const user = userRows[0] || {};
  const createdName = [cleanDbText(user.first_name), cleanDbText(user.last_name)].filter(Boolean).join(" ") || null;

  const data = {
    receive_business_id: cleanReceiveId,
    receive_code: cleanDbText(receiveCode),
    customer_id: toNumberOrNull(customerId),
    source_type: cleanSourceType,
    source_import_id: toNumberOrNull(sourceImportId),
    detail_count: toNumberOrZero(detailCount),
    item_count: toNumberOrZero(itemCount),
    created_by: cleanCreatedBy,
    created_username: cleanDbText(user.username),
    created_name: createdName,
    warehouse_id: toNumberOrNull(user.warehouse_id),
    created_at: new Date(),
  };

  const { sql, values } = buildInsertSql("logs_receive_create", data);
  await conn.query(sql, values);
};
