export const loadAddressMap = async (connection) => {
  const [rows] = await connection.query(`
    SELECT subdistrict_id, warehouse_id
    FROM mm_master_addresses
  `);

  const map = {};

  rows.forEach((r) => {
    map[r.subdistrict_id] = r.warehouse_id;
  });

  return map;
};