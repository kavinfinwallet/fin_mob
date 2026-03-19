import ExcelJS from 'exceljs';

/**
 * Build and download Excel of uncategorized transactions with Category dropdown.
 * @param {Array<{id, date, description, amount, type, categoryName}>} transactions - uncategorized only
 * @param {Array<{label:string, value:string}>} categoryOptions - for dropdown (value = category name)
 */
const CATEGORY_REF_SHEET_NAME = 'CategoryList';

export async function downloadUncategorizedExcel(transactions, categoryOptions) {
  const workbook = new ExcelJS.Workbook();

  const categoryList = (categoryOptions || [])
    .map((o) => (o.value || o.label || '').toString().trim())
    .filter(Boolean);

  if (categoryList.length > 0) {
    const refSheet = workbook.addWorksheet(CATEGORY_REF_SHEET_NAME);
    categoryList.forEach((name, i) => {
      refSheet.getCell(i + 1, 1).value = name;
    });
    refSheet.state = 'hidden';
  }

  const sheet = workbook.addWorksheet('Uncategorized', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Id', key: 'id', width: 12 },
    { header: 'Sr. No.', key: 'srNo', width: 10 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Description', key: 'description', width: 45 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Category', key: 'category', width: 22 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  transactions.forEach((t, i) => {
    sheet.addRow({
      id: t.id,
      srNo: i + 1,
      date: formatDateForExcel(t.date),
      description: t.description ?? '',
      amount: t.amount != null && t.amount !== '' ? Number(t.amount) : '',
      type: (t.type || 'Debit').toString().trim(),
      category: (t.categoryName ?? t.category_name ?? 'Uncategorized').toString().trim(),
    });
  });

  if (categoryList.length > 0) {
    const lastRow = Math.max(1, categoryList.length);
    sheet.dataValidations.add(`G2:G${Math.max(2, transactions.length + 1)}`, {
      type: 'list',
      allowBlank: true,
      formulae: [`=${CATEGORY_REF_SHEET_NAME}!$A$1:$A$${lastRow}`],
      showErrorMessage: true,
      errorTitle: 'Invalid category',
      error: 'Select a value from the dropdown list.',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `uncategorized-transactions-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDateForExcel(date) {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return String(date);
  return d.toISOString().slice(0, 10);
}

/**
 * Parse uploaded Excel and validate rows. Returns { rows, errors, errorRows } where
 * errors[i] is the error message for row i (1-based), errorRows is Set of 1-based row numbers.
 */
const DATA_SHEET_NAME = 'Uncategorized';

function getDataSheet(workbook) {
  const byName = workbook.getWorksheet(DATA_SHEET_NAME);
  if (byName) return byName;
  for (let i = 0; i < workbook.worksheets.length; i++) {
    const ws = workbook.worksheets[i];
    const firstRow = ws.getRow(1);
    if (!firstRow) continue;
    const headerMap = {};
    firstRow.eachCell((cell, colNumber) => {
      const val = cell && cell.value;
      const text = val != null ? String(val).trim() : '';
      if (text) headerMap[text.toLowerCase()] = colNumber;
    });
    if (headerMap['id'] != null && headerMap['category'] != null) return ws;
  }
  return workbook.worksheets[0] || null;
}

export async function parseAndValidateUploadedSheet(file, validIds, validCategories) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file);

  const sheet = getDataSheet(workbook);
  if (!sheet) return { rows: [], errors: [], errorRows: new Set(), workbook: null };

  const idSet = new Set(validIds.map((id) => String(id)));
  const categorySet = new Set(
    (validCategories || []).map((c) => String(c.value || c.label || c).trim().toLowerCase())
  );
  categorySet.add('uncategorized');

  const rows = [];
  const errors = [];
  const errorRows = new Set();
  let headers = [];
  const headerMap = {}; // lowercase header -> column index (1-based)

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell((cell, colNumber) => {
        const val = (cell.value && String(cell.value).trim()) || '';
        if (val) headerMap[val.toLowerCase()] = colNumber;
      });
      return;
    }

    const get = (key) => {
      const col = headerMap[key.toLowerCase()];
      if (col == null) return '';
      const cell = row.getCell(col);
      const v = cell && cell.value;
      return v != null ? String(v).trim() : '';
    };

    const idVal = get('id');
    const categoryVal = get('category');
    const dateVal = get('date');
    const descriptionVal = get('description');
    const amountVal = get('amount');
    const typeVal = get('type');

    const isEmptyRow = !idVal && !categoryVal && !dateVal && !descriptionVal && amountVal === '' && !typeVal;
    if (isEmptyRow) return;

    const rowErrors = [];

    if (!idVal) {
      rowErrors.push('Id is required.');
    } else {
      const idNum = parseInt(idVal, 10);
      if (Number.isNaN(idNum)) {
        rowErrors.push('Id must be a number.');
      } else if (!idSet.has(String(idNum))) {
        rowErrors.push('Id not found in current transactions.');
      }
    }

    if (categoryVal === '' || categoryVal == null) {
      rowErrors.push('Category is required.');
    } else if (!categorySet.has(categoryVal.toLowerCase())) {
      rowErrors.push(`Invalid category: "${categoryVal}". Choose from the dropdown.`);
    }

    const errMsg = rowErrors.length > 0 ? rowErrors.join(' ') : null;
    errors[rowNumber - 1] = errMsg;
    if (errMsg) errorRows.add(rowNumber);

    rows.push({
      rowNumber,
      id: idVal ? parseInt(idVal, 10) : null,
      date: dateVal || null,
      description: descriptionVal ?? '',
      amount: amountVal !== '' ? (Number(amountVal) || amountVal) : null,
      type: typeVal || null,
      category: categoryVal ? categoryVal.trim() : '',
      error: errMsg,
    });
  });

  return {
    rows: rows.filter((r) => r.id != null),
    errors,
    errorRows,
    workbook,
    sheet,
    headerMap,
  };
}

const ERROR_COL_INDEX = 8; // Column H (after Id..Category = 7 cols)

/**
 * Build error Excel from existing workbook/sheet: add Error column, mark error rows red, then download.
 * @param {object} workbook - ExcelJS workbook
 * @param {Set<number>} errorRows - 1-based row numbers with errors
 * @param {string[]} errors - error messages by 0-based index (errors[rowNum-1])
 * @param {object} [dataSheet] - optional sheet that was parsed (use this when workbook has multiple sheets)
 */
export async function downloadErrorExcel(workbook, errorRows, errors, dataSheet) {
  const sheet = dataSheet || workbook.worksheets[0];
  if (!sheet) return;

  sheet.getRow(1).getCell(ERROR_COL_INDEX).value = 'Error';
  sheet.getRow(1).getCell(ERROR_COL_INDEX).font = { bold: true };
  sheet.getRow(1).getCell(ERROR_COL_INDEX).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  errorRows.forEach((rowNum) => {
    const row = sheet.getRow(rowNum);
    row.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFCDD2' },
      };
    });
    const errMsg = errors[rowNum - 1] || 'Unknown error';
    row.getCell(ERROR_COL_INDEX).value = errMsg;
    row.getCell(ERROR_COL_INDEX).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFCDD2' },
    };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `upload-errors-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
