const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000';

/**
 * Parse PDF using FastAPI service
 * @param {string} filePath - Path to the PDF file
 * @param {string|null} password - Password for encrypted PDF (optional)
 * @returns {Promise<Object>} Parsed data with transactions and columns
 */
const parsePDFWithFastAPI = async (filePath, password = null) => {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error('PDF file not found');
    }

    // Create form data
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    if (password) {
      formData.append('password', password);
    }

    // Call FastAPI service
    const response = await axios.post(
      `${FASTAPI_URL}/extract-transactions`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
        },
        timeout: 60000, // 60 seconds timeout for large PDFs
      }
    );

    if (!response.data.success) {
      throw new Error('Failed to extract transactions from PDF');
    }

    // Transform FastAPI response to match existing format
    const { transactions, columns, total_transactions } = response.data;

    // Transform transactions to flat format - just the rawData properties directly
    const transformedTransactions = transactions.map((txn, index) => {
      // Return flat format - all properties directly in the transaction object
      // This includes all column names like "Transaction\nDate", "Particulars", etc.
      const flatTransaction = { ...txn };
      
      // Ensure page is included if it exists
      if (txn.page) {
        flatTransaction.page = txn.page;
      }
      
      return flatTransaction;
    });

    // Ensure Credit and Debit are in the columns list for dropdown mapping
    const columnsWithCreditDebit = [...columns];
    if (!columnsWithCreditDebit.includes('Credit')) {
      columnsWithCreditDebit.push('Credit');
    }
    if (!columnsWithCreditDebit.includes('Debit')) {
      columnsWithCreditDebit.push('Debit');
    }

    return {
      transactions: transformedTransactions,
      tableInfo: {
        columns: columnsWithCreditDebit,
        headerRow: null,
        startIndex: 0,
      },
      metadata: {
        pages: Math.max(...transactions.map(t => t.page || 1)),
        totalTransactions: total_transactions,
      },
      columns: columnsWithCreditDebit, // Available columns for dropdown (includes Credit and Debit)
    };
  } catch (error) {
    console.error('FastAPI PDF parsing error:', error);
    
    // Provide helpful error messages
    if (error.code === 'ECONNREFUSED') {
      throw new Error('FastAPI service is not running. Please start the FastAPI service on port 8000.');
    }
    
    if (error.response) {
      const errorDetail = error.response.data?.detail || error.response.data?.message || error.message;
      
      // Check if error is password-related
      if (errorDetail.toLowerCase().includes('password') || 
          errorDetail.toLowerCase().includes('encrypted') ||
          errorDetail.toLowerCase().includes('protected')) {
        throw new Error('PDF is password protected. Please provide the password.');
      }
      
      throw new Error(errorDetail);
    }
    
    throw new Error('Failed to parse PDF: ' + error.message);
  }
};

/**
 * Call FastAPI tabula-extract-data (Excel/CSV) and return parsed transactions
 * @param {string} filePath - Path to the Excel or CSV file
 * @param {string|null} sheetName - Optional sheet name for Excel
 * @returns {Promise<Object>} { transactions, columns_mapping, ... }
 */
const tabulaExtractData = async (filePath, sheetName = null) => {
  if (!fs.existsSync(filePath)) {
    throw new Error('File not found');
  }
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));
  if (sheetName) {
    formData.append('sheet_name', sheetName);
  }
  const response = await axios.post(
    `${FASTAPI_URL}/tabula-extract-data`,
    formData,
    {
      headers: formData.getHeaders(),
      timeout: 120000,
    }
  );
  return response.data;
};

module.exports = {
  parsePDFWithFastAPI,
  tabulaExtractData,
};

