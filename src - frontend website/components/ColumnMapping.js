import React, { useState, useEffect, useMemo, useCallback } from 'react';
import MUITable from './MUITable';
import Select from './Select';
import './ColumnMapping.css';

const ColumnMapping = ({ transactions, detectedColumns, columnNames = [], onComplete, onCancel, loading }) => {
  const [mapping, setMapping] = useState({
    date: '',
    description: '',
    amount: '',
    credit: '',
    debit: ''
  });

  const columnOptions = [
    { value: 'date', label: 'Date' },
    { value: 'description', label: 'Description/Remarks' },
    { value: 'amount', label: 'Amount' },
    { value: 'credit', label: 'Credit' },
    { value: 'debit', label: 'Debit' }
  ];

  // Get available columns - prefer actual column names from PDF header
  const availableColumns = useMemo(() => {
    // If we have column names from PDF header, use those
    if (columnNames && columnNames.length > 0) {
      return columnNames.map((name, index) => ({
        name: name,
        key: `column_${index}`,
        displayName: name
      }));
    }
    
    // Fallback: get columns from transaction properties (flat format)
    if (transactions.length === 0) return [];
    
    const firstTxn = transactions[0];
    const columns = [];
    
    // Add direct properties (excluding internal ones)
    // In flat format, all column names are direct properties
    Object.keys(firstTxn).forEach(key => {
      if (key !== 'raw' && key !== 'rawData' && key !== 'sNo' && key !== 'page' && !key.startsWith('column_')) {
        columns.push({
          name: key,
          key: key,
          displayName: key
        });
      }
    });
    
    // Also check rawData for backward compatibility
    if (firstTxn.rawData) {
      Object.keys(firstTxn.rawData).forEach(key => {
        if (key !== 'sNo' && key.startsWith('column_')) {
          const columnName = firstTxn.rawData[key + '_name'] || key;
          if (!columns.find(col => col.name === columnName)) {
            columns.push({
              name: columnName,
              key: key,
              displayName: columnName
            });
          }
        }
      });
    }
    
    return columns;
  }, [columnNames, transactions]);
  
  // Helper to get value from transaction by column key or name
  const getTransactionValue = useCallback((txn, key) => {
    if (!key) return null;
    
    // First, check direct properties (for flat format - transactions have properties directly)
    // This handles cases where transaction has "Transaction\nDate", "Particulars", etc. as direct properties
    if (txn[key]) {
      return txn[key];
    }
    
    // If key is a column key like "column_5", get the actual column name from columnNames
    let actualColumnName = key;
    if (key.startsWith('column_')) {
      const index = parseInt(key.replace('column_', ''));
      if (!isNaN(index) && columnNames && columnNames[index]) {
        actualColumnName = columnNames[index];
      }
    }
    
    // Check direct properties by actual column name
    if (txn[actualColumnName]) {
      return txn[actualColumnName];
    }
    
    // If key is a column name (from header), find the corresponding column index
    const column = availableColumns.find(col => col.name === key || col.key === key);
    const lookupKey = column ? column.key : key;
    
    // Check rawData (for backward compatibility)
    if (txn.rawData && txn.rawData[lookupKey]) {
      return txn.rawData[lookupKey];
    }
    
    // Also check by column name if stored in rawData
    if (column && txn.rawData && txn.rawData[column.name]) {
      return txn.rawData[column.name];
    }
    
    // Check direct properties by lookupKey
    if (txn[lookupKey]) {
      return txn[lookupKey];
    }
    
    return null;
  }, [availableColumns, columnNames]);
  
  // Convert column name to column key for backend processing
  const getColumnKey = (columnNameOrKey) => {
    if (!columnNameOrKey) return null;
    
    // If it's already a column key (column_0, etc.), return as is
    if (columnNameOrKey.startsWith('column_')) {
      return columnNameOrKey;
    }
    
    // Find the column and return its key
    const column = availableColumns.find(col => col.name === columnNameOrKey || col.key === columnNameOrKey);
    return column ? column.key : columnNameOrKey;
  };

  useEffect(() => {
    if (detectedColumns && availableColumns.length > 0) {
      // Convert detected column keys to column names for display
      const getColumnNameFromKey = (key) => {
        if (!key) return '';
        // If it's already a column name, return as is
        const column = availableColumns.find(col => col.key === key || col.name === key);
        return column ? column.name : key;
      };
      
      setMapping({
        date: getColumnNameFromKey(detectedColumns.date) || '',
        description: getColumnNameFromKey(detectedColumns.description) || '',
        amount: getColumnNameFromKey(detectedColumns.amount) || '',
        credit: getColumnNameFromKey(detectedColumns.credit) || '',
        debit: getColumnNameFromKey(detectedColumns.debit) || ''
      });
    }
  }, [detectedColumns, columnNames, availableColumns]);

  const handleMappingChange = (field, value) => {
    setMapping({
      ...mapping,
      [field]: value
    });
  };

  const handleSubmit = () => {
    // Validate required mappings
    if (!mapping.date || !mapping.description || !mapping.amount) {
      alert('Please map Date, Description, and Amount columns');
      return;
    }
    
    // Convert column names to column keys for backend processing
    const mappingForBackend = {
      date: getColumnKey(mapping.date),
      description: getColumnKey(mapping.description),
      amount: getColumnKey(mapping.amount),
      credit: mapping.credit ? getColumnKey(mapping.credit) : null,
      debit: mapping.debit ? getColumnKey(mapping.debit) : null
    };
    
    onComplete(mappingForBackend);
  };

  const previewColumns = useMemo(() => [
    {
      accessorKey: 'date',
      header: 'Date',
      cell: ({ row }) => {
        const txn = row.original;
        return mapping.date ? getTransactionValue(txn, mapping.date) || '-' : '-';
      },
    },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ row }) => {
        const txn = row.original;
        return mapping.description ? getTransactionValue(txn, mapping.description) || '-' : '-';
      },
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      cell: ({ row }) => {
        const txn = row.original;
        return mapping.amount ? getTransactionValue(txn, mapping.amount) || '-' : '-';
      },
    },
    {
      accessorKey: 'credit',
      header: 'Credit',
      cell: ({ row }) => {
        const txn = row.original;
        return mapping.credit ? getTransactionValue(txn, mapping.credit) || '-' : '-';
      },
    },
    {
      accessorKey: 'debit',
      header: 'Debit',
      cell: ({ row }) => {
        const txn = row.original;
        return mapping.debit ? getTransactionValue(txn, mapping.debit) || '-' : '-';
      },
    },
  ], [mapping, getTransactionValue]);

  return (
    <div className="column-mapping-container">
      <div className="mapping-card">
        <h2>Column Mapping</h2>
        <p className="mapping-description">
          Map the columns from your bank statement to the required fields.
          This helps us correctly extract and categorize your transactions.
        </p>

        <div className="mapping-form">
          {columnOptions.map(option => (
            <div key={option.value} className="mapping-row">
              <label className="mapping-label">{option.label}</label>
              <Select
                className="mapping-select"
                value={mapping[option.value] || ''}
                onChange={(e) => handleMappingChange(option.value, e.target.value)}
                placeholder="Select column..."
              >
                <option value="">Select column...</option>
                {availableColumns.map((col, idx) => (
                  <option key={col.key || idx} value={col.name || col.key}>
                    {col.displayName || col.name || col.key}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>

        {transactions.length > 0 && (
          <div className="preview-section">
            <h3>Preview Transactions</h3>
            <MUITable
              data={transactions}
              columns={previewColumns}
              enableSorting={true}
              enablePagination={true}
              pageSize={20}
              title="Parsed Transactions Preview"
            />
          </div>
        )}

        <div className="mapping-actions">
          <button onClick={onCancel} className="btn-secondary" disabled={loading}>
            Cancel
          </button>
          <button onClick={handleSubmit} className="btn-primary" disabled={loading}>
            {loading ? 'Processing...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ColumnMapping;

