export const getPrintSummaryJoinSql = () => {
  return `
    LEFT JOIN (
      SELECT
        serial_id,
        customer_id,
        COUNT(*) AS total_print_count,
        SUM(
          CASE
            WHEN print_type = 'REPRINT' THEN 1
            ELSE 0
          END
        ) AS reprint_count,
        MAX(created_at) AS last_printed_at
      FROM logs_label_print
      GROUP BY serial_id, customer_id
    ) lp
      ON lp.serial_id = rs.serial_id
      AND lp.customer_id = rs.customer_id
  `;
};
