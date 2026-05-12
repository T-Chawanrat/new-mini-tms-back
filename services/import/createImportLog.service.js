export const createImportLog = async (
  connection,
  {
    userId,
    customerId,
    importType,
    fileName,
    totalRows,
  },
) => {
  const [result] = await connection.query(
    `
    INSERT INTO logs_imports (
      user_id,
      customer_id,
      import_type,
      input_type,
      file_name,
      total_rows,
      success_rows,
      failed_rows
    )
    VALUES (?, ?, ?, 'EXCEL', ?, ?, 0, 0)
    `,
    [
      userId,
      customerId,
      importType,
      fileName || null,
      totalRows,
    ],
  );

  return result.insertId;
};