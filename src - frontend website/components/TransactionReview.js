import React, { useMemo, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Button } from 'primereact/button';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import { formatCurrency as formatCurrencyUtil } from '../constants/currencies';
import { formatTransactionDate, toDateInputValue as toDateInputValueUtil } from '../utils/format';
import {
  downloadUncategorizedExcel,
  parseAndValidateUploadedSheet,
  downloadErrorExcel,
} from '../utils/reviewExcel';
import './TransactionReview.css';

const apiBase = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Normalize transaction for UI: ensure id, categoryName (camelCase), categoryId. Resume API uses snake_case.
function normalizeTransaction(txn, index) {
  const name = txn.categoryName ?? txn.category_name ?? '';
  const categoryName =
    typeof name === 'string' && name.trim() ? name.trim() : 'Uncategorized';
  return {
    ...txn,
    id: txn.id || `temp-${index}-${Date.now()}`,
    categoryName,
    categoryId: txn.categoryId ?? txn.category_id ?? null,
  };
}

// First and last day of month in YYYY-MM-DD for date input min/max
function getBudgetMonthDateRange(periodMonth, periodYear) {
  if (periodMonth == null || periodYear == null) return { min: null, max: null };
  const m = Number(periodMonth);
  const y = Number(periodYear);
  if (!Number.isFinite(m) || !Number.isFinite(y) || m < 1 || m > 12) return { min: null, max: null };
  const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDate = new Date(y, m, 0);
  const lastDay = `${y}-${String(m).padStart(2, '0')}-${String(lastDate.getDate()).padStart(2, '0')}`;
  return { min: firstDay, max: lastDay };
}

const TransactionReview = ({
  transactions,
  columnMapping,
  columnNames,
  onApproval,
  onSubmitForApproval,
  onCancel,
  onViewAnalytics,
  onCategoriesUpdated,
  loading,
  currentUser,
  uploadStatus,
  uploadId,
  preloadedCategories,
  selectedCustomer,
  periodMonth,
  periodYear,
}) => {
  const [editableTransactions, setEditableTransactions] = useState(() =>
    (transactions || []).map((txn, i) => normalizeTransaction(txn, i))
  );
  const [editingRowId, setEditingRowId] = useState(null);
  const [savingRowId, setSavingRowId] = useState(null);
  const [deletingRowId, setDeletingRowId] = useState(null);
  const [selectedTransactions, setSelectedTransactions] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [fetchedCategories, setFetchedCategories] = useState([]);
  const [categoryGroups, setCategoryGroups] = useState([]);
  const [activeGroup, setActiveGroup] = useState('ALL');
  const [categoryNameFilter, setCategoryNameFilter] = useState('ALL'); // 'ALL' | specific category name
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'debit' | 'credit'
  const [searchTerm, setSearchTerm] = useState('');
  const [paginationState, setPaginationState] = useState({ first: 0, rows: 20 });
  const [expandedDescriptionIds, setExpandedDescriptionIds] = useState(() => new Set());
  const [excelDownloading, setExcelDownloading] = useState(false);
  const [excelUploading, setExcelUploading] = useState(false);
  const [uploadProgressMessage, setUploadProgressMessage] = useState(null);
  const uploadSheetInputRef = React.useRef(null);

  const availableCategories =
    preloadedCategories && preloadedCategories.length > 0 ? preloadedCategories : fetchedCategories;

  // Keep preloaded categories in state so they survive after parent clears location.state
  useEffect(() => {
    if (preloadedCategories && preloadedCategories.length > 0) {
      setFetchedCategories((prev) => (prev.length > 0 ? prev : preloadedCategories));
    }
  }, [preloadedCategories]);

  // Load category groups and categories from database (so we have them when not coming from analytics)
  useEffect(() => {
    const load = async () => {
      try {
        const [groupsRes, categoriesRes] = await Promise.all([
          axios.get(`${apiBase}/categories/groups`),
          axios.get(`${apiBase}/categories`),
        ]);
        setCategoryGroups(groupsRes.data.groups || []);
        setFetchedCategories((prev) =>
          prev.length > 0 ? prev : (categoriesRes.data.categories || [])
        );
      } catch (error) {
        console.error('Error loading category groups/categories:', error);
      }
    };
    load();
  }, []);

  // Resolve group name for a category (from DB category list)
  const getCategoryGroup = useCallback((categoryName) => {
    if (!categoryName) return 'Others';
    const cat = (availableCategories || []).find(
      (c) => String(c.name).trim().toLowerCase() === String(categoryName).trim().toLowerCase()
    );
    return (cat && cat.group_name) ? cat.group_name : 'Others';
  }, [availableCategories]);

  // Update editable transactions when transactions prop changes (e.g. resume)
  useEffect(() => {
    if (!transactions || !transactions.length) {
      setEditableTransactions([]);
      return;
    }
    setEditableTransactions(transactions.map((txn, index) => normalizeTransaction(txn, index)));
  }, [transactions]);

  const resolveCategoryId = useCallback((categoryName) => {
    const nameNorm = (categoryName != null ? String(categoryName).trim() : '') || 'Uncategorized';
    const category = (availableCategories || []).find(
      (c) => String(c.name || '').trim().toLowerCase() === nameNorm.toLowerCase()
    );
    return category ? category.id : null;
  }, [availableCategories]);

  const handleCategoryChange = useCallback(
    async (txn, selectedOption) => {
      if (selectedOption == null) return;
      const opt = selectedOption;
      const displayName = (opt.label || opt.value || '').trim() || 'Uncategorized';
      const categoryId =
        opt.id != null && opt.id !== ''
          ? (typeof opt.id === 'number' ? opt.id : parseInt(opt.id, 10))
          : resolveCategoryId(opt.value || displayName);
      const validId = Number.isFinite(categoryId) ? categoryId : null;

      setEditableTransactions((prev) =>
        prev.map((t) =>
          (t.id != null && txn.id != null && String(t.id) === String(txn.id)) || t === txn
            ? { ...t, categoryName: displayName, categoryId: validId }
            : t
        )
      );

      const txnId = txn.id;
      if (typeof txnId === 'number' && !Number.isNaN(txnId)) {
        try {
          await axios.patch(`${apiBase}/transactions/${txnId}/category`, {
            categoryId: validId,
            categoryName: displayName,
          });
        } catch (err) {
          console.error('Failed to save category:', err);
        }
      }
    },
    [resolveCategoryId]
  );

  const formatDate = formatTransactionDate;
  const toDateInputValue = toDateInputValueUtil;

  const isNewRow = (id) => typeof id === 'string' && String(id).startsWith('new-');

  const budgetMonthRange = useMemo(
    () => getBudgetMonthDateRange(periodMonth, periodYear),
    [periodMonth, periodYear]
  );

  const updateRowField = useCallback((rowId, field, value) => {
    setEditableTransactions((prev) =>
      prev.map((t) => {
        if (t.id !== rowId && t !== rowId) return t;
        return { ...t, [field]: value };
      })
    );
  }, []);

  const formatAmount = (amount) => formatCurrencyUtil(amount, selectedCustomer);

  // Options: all categories with id so we never send null when changing; grouped by group_name
  const categoryOptions = useMemo(() => {
    const fromApi = (availableCategories || []).map((cat) => ({
      label: cat.name,
      value: cat.name,
      id: cat.id,
      groupName: (cat.group_name || 'Others').trim(),
    }));
    const fromTxns = (editableTransactions || [])
      .map((t) => ((t.categoryName ?? t.category_name) ?? '').trim())
      .filter((n) => n && n !== 'Uncategorized');
    const fromTxnsUnique = [];
    const seen = new Set(['Uncategorized', ...fromApi.map((o) => o.value)]);
    fromTxns.forEach((n) => {
      if (seen.has(n)) return;
      seen.add(n);
      const match = fromApi.find((c) => String(c.value).trim().toLowerCase() === n.toLowerCase());
      fromTxnsUnique.push(
        match
          ? { label: match.label, value: match.value, id: match.id, groupName: match.groupName }
          : { label: n, value: n, id: null, groupName: 'Others' }
      );
    });
    return [
      { label: 'Uncategorized', value: 'Uncategorized', id: null, groupName: 'Others' },
      ...fromApi,
      ...fromTxnsUnique,
    ];
  }, [availableCategories, editableTransactions]);

  const isEditing = (rowData) =>
    editingRowId != null && rowData?.id != null && String(rowData.id) === String(editingRowId);

  const dateBodyTemplate = (rowData) => {
    if (isEditing(rowData) && canEditCategories) {
      return (
        <input
          type="date"
          className="review-inline-input review-date-input"
          value={toDateInputValue(rowData.date)}
          min={budgetMonthRange.min ?? undefined}
          max={budgetMonthRange.max ?? undefined}
          onChange={(e) => updateRowField(rowData.id, 'date', e.target.value)}
        />
      );
    }
    const value = rowData.date;
    return value ? formatDate(value) : '—';
  };

  const DESCRIPTION_TRUNCATE_LEN = 120;

  const toggleDescriptionExpand = useCallback((rowId) => {
    setExpandedDescriptionIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const descriptionBodyTemplate = (rowData) => {
    if (isEditing(rowData) && canEditCategories) {
      return (
        <InputTextarea
          className="review-desc-textarea"
          value={rowData.description || ''}
          onChange={(e) => updateRowField(rowData.id, 'description', e.target.value)}
          placeholder="Description"
          rows={3}
          autoResize
        />
      );
    }
    const text = rowData.description || '-';
    const id = rowData.id;
    const isLong = text.length > DESCRIPTION_TRUNCATE_LEN;
    const isExpanded = id != null && expandedDescriptionIds.has(id);
    const showFull = !isLong || isExpanded;
    return (
      <div className="review-description-cell-wrapper">
        <div
          className={`review-description-cell ${showFull ? 'review-description-cell-full' : 'review-description-cell-truncated'}`}
        >
          {showFull ? text : `${text.slice(0, DESCRIPTION_TRUNCATE_LEN)}…`}
        </div>
        {isLong && (
          <button
            type="button"
            className="review-description-toggle"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              toggleDescriptionExpand(id);
            }}
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    );
  };

  const amountBodyTemplate = (rowData) => {
    if (isEditing(rowData) && canEditCategories) {
      return (
        <span className="review-cell-amount">
          <InputText
            className="review-inline-input review-amount-input"
            value={rowData.amount !== null && rowData.amount !== undefined && rowData.amount !== '' ? String(rowData.amount) : ''}
            onChange={(e) => updateRowField(rowData.id, 'amount', e.target.value)}
            placeholder="Amount"
          />
        </span>
      );
    }
    const value = rowData.amount;
    if (value !== null && value !== undefined && value !== '') {
      const numAmount =
        typeof value === 'number'
          ? value
          : parseFloat(String(value).replace(/,/g, ''));
      return <span className="review-cell-amount">{Number.isNaN(numAmount) ? value : formatAmount(numAmount)}</span>;
    }
    return <span className="review-cell-amount">-</span>;
  };

  const typeOptions = [{ label: 'Credit', value: 'Credit' }, { label: 'Debit', value: 'Debit' }];
  const typeBodyTemplate = (rowData) => {
    if (isEditing(rowData) && canEditCategories) {
      const typeVal = (rowData.type || 'Debit').toString().toLowerCase();
      const current = typeVal === 'credit' ? 'Credit' : 'Debit';
      const valueOption = typeOptions.find((o) => o.value === current) || typeOptions[1];
      return (
        <Autocomplete
          value={valueOption}
          options={typeOptions}
          getOptionLabel={(opt) => opt?.label ?? ''}
          isOptionEqualToValue={(opt, val) => opt.value === val.value}
          onChange={(e, newValue) => updateRowField(rowData.id, 'type', newValue?.value ?? 'Debit')}
          size="small"
          className="review-row-autocomplete review-row-type-autocomplete"
          sx={{ minWidth: '8rem' }}
          renderInput={(params) => <TextField {...params} size="small" />}
        />
      );
    }
    const type = rowData.type || '-';
    return type
      ? String(type).charAt(0).toUpperCase() + String(type).slice(1)
      : '-';
  };

  // Serial = 1-based index in the full filtered list (so it stays correct when switching pages)
  const serialNumberBody = (rowData) => {
    const idx = (filteredTransactions || []).findIndex((r) => String(r.id) === String(rowData?.id));
    return idx >= 0 ? idx + 1 : '';
  };

  const categoryBodyTemplate = (rowData) => {
    const raw = rowData.categoryName ?? rowData.category_name;
    const value = (typeof raw === 'string' && raw.trim()) ? raw.trim() : 'Uncategorized';
    if (!canEditCategories) {
      return <span className="review-category-readonly">{value}</span>;
    }
    if (!availableCategories || availableCategories.length === 0) {
      return <span className="review-category-readonly">{value}</span>;
    }
    const valueOption =
      categoryOptions.find((o) => String(o.value).trim().toLowerCase() === value.toLowerCase()) ||
      { label: 'Uncategorized', value: 'Uncategorized', id: null, groupName: 'Others' };
    return (
      <Autocomplete
        value={valueOption}
        options={categoryOptions}
        groupBy={(option) => option.groupName || 'Others'}
        getOptionLabel={(opt) => opt?.label ?? ''}
        isOptionEqualToValue={(opt, val) => opt.value === val.value && (opt.id == null) === (val.id == null)}
        onChange={(e, newValue) => handleCategoryChange(rowData, newValue)}
        disableClearable
        size="small"
        className="review-row-autocomplete review-row-category-autocomplete"
        sx={{ minWidth: '5.5rem', width: '100%', maxWidth: '10rem' }}
        renderInput={(params) => <TextField {...params} placeholder="Category" size="small" />}
      />
    );
  };

  const actionsBodyTemplate = (rowData) => {
    const editing = isEditing(rowData);
    const saving = String(savingRowId) === String(rowData?.id);
    const deleting = String(deletingRowId) === String(rowData?.id);
    const newRow = isNewRow(rowData.id);
    const busy = saving || deleting;
    if (!canEditCategories) return null;
    const stop = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    return (
      <div className="review-row-actions review-row-actions-icons" onClick={stop}>
        {!editing && !newRow && (
          <Button
            type="button"
            icon="pi pi-pencil"
            title="Edit"
            className="p-button-text p-button-rounded p-button-sm review-btn-edit"
            onClick={(e) => {
              stop(e);
              handleEdit(rowData);
            }}
            disabled={busy}
          />
        )}
        {(editing || newRow) && (
          <>
            <Button
              type="button"
              icon={saving ? 'pi pi-spin pi-spinner' : 'pi pi-check'}
              title={saving ? 'Saving...' : 'Save'}
              className="p-button-text p-button-rounded p-button-sm p-button-success review-btn-save"
              onClick={(e) => {
                stop(e);
                handleSave(rowData);
              }}
              disabled={busy || (newRow && !(rowData.description || '').trim())}
            />
            <Button
              type="button"
            icon="pi pi-times"
            title="Cancel"
              className="p-button-text p-button-rounded p-button-sm review-btn-cancel"
              onClick={(e) => {
                stop(e);
                handleCancelEdit(rowData);
              }}
              disabled={busy}
            />
          </>
        )}
        <Button
          type="button"
          icon={deleting ? 'pi pi-spin pi-spinner' : 'pi pi-trash'}
          title={deleting ? 'Deleting...' : 'Delete'}
          className="p-button-text p-button-rounded p-button-sm p-button-danger review-btn-delete"
          onClick={(e) => {
            stop(e);
            handleDelete(rowData);
          }}
          disabled={busy}
        />
      </div>
    );
  };

  const isRelationshipManager = currentUser?.role === 'RELATIONSHIP_MANAGER';
  const isAdminOrTL =
    currentUser?.role === 'SUPER_ADMIN' ||
    currentUser?.role === 'ADMIN' ||
    currentUser?.role === 'TEAM_LEAD' ||
    currentUser?.is_super_admin;

  const canSubmit =
    isRelationshipManager &&
    uploadStatus !== 'submitted' &&
    uploadStatus !== 'completed';

  // RM: no edit when submitted/completed. TL/Admin: can edit when submitted (review flow).
  const canEditCategories =
    (uploadStatus !== 'submitted' && uploadStatus !== 'completed') || isAdminOrTL;

  const handleEdit = useCallback((row) => {
    setEditingRowId(row.id);
  }, []);

  const handleCancelEdit = useCallback((row) => {
    if (isNewRow(row.id)) {
      setEditableTransactions((prev) => prev.filter((t) => t.id !== row.id));
    }
    setEditingRowId(null);
  }, []);

  const handleSave = useCallback(
    async (row) => {
      if (!canEditCategories) return;
      setSavingRowId(row.id);
      try {
        if (isNewRow(row.id)) {
          if (!uploadId) {
            console.error('Upload ID required to add transaction');
            setSavingRowId(null);
            return;
          }
          const catName = row.categoryName || 'Uncategorized';
          const payload = {
            uploadId,
            date: row.date || new Date().toISOString().slice(0, 10),
            description: row.description || '',
            amount: row.amount !== '' && row.amount != null ? parseFloat(row.amount) : 0,
            type: row.type || 'Debit',
            categoryName: catName,
            categoryId: row.categoryId ?? resolveCategoryId(catName),
          };
          const res = await axios.post(`${apiBase}/transactions`, payload);
          const newTxn = normalizeTransaction(
            {
              ...res.data,
              category_name: res.data.categoryName,
              category_id: res.data.categoryId,
            },
            0
          );
          setEditableTransactions((prev) =>
            prev.map((t) => (t.id === row.id ? { ...newTxn, id: res.data.id } : t))
          );
        } else {
          const id = typeof row.id === 'number' ? row.id : parseInt(row.id, 10);
          if (Number.isNaN(id)) {
            setSavingRowId(null);
            return;
          }
          const payload = {
            date: row.date,
            description: row.description,
            amount: row.amount !== '' && row.amount != null ? parseFloat(row.amount) : undefined,
            type: row.type,
          };
          const res = await axios.patch(`${apiBase}/transactions/${id}`, payload);
          const updated = normalizeTransaction(
            { ...res.data, category_name: res.data.categoryName, category_id: res.data.categoryId },
            0
          );
          setEditableTransactions((prev) =>
            prev.map((t) => (t.id === id ? { ...t, ...updated } : t))
          );
        }
        setEditingRowId(null);
      } catch (err) {
        console.error('Save transaction error:', err);
      } finally {
        setSavingRowId(null);
      }
    },
    [canEditCategories, uploadId, resolveCategoryId]
  );

  const performDelete = useCallback(
    async (row) => {
      if (isNewRow(row.id)) {
        setEditableTransactions((prev) => prev.filter((t) => t.id !== row.id));
        setEditingRowId(null);
        return;
      }
      const id = typeof row.id === 'number' ? row.id : parseInt(row.id, 10);
      if (Number.isNaN(id)) return;
      try {
        setDeletingRowId(id);
        await axios.delete(`${apiBase}/transactions/${id}`);
        setEditableTransactions((prev) => prev.filter((t) => String(t.id) !== String(id)));
        if (editingRowId != null && String(editingRowId) === String(id)) setEditingRowId(null);
      } catch (err) {
        console.error('Delete transaction error:', err);
      } finally {
        setDeletingRowId(null);
      }
    },
    [editingRowId]
  );

  const handleDelete = useCallback(
    (row) => {
      if (!canEditCategories) return;
      if (isNewRow(row.id)) {
        confirmDialog({
          header: 'Remove row',
          message: 'Remove this unsaved transaction from the list?',
          icon: 'pi pi-exclamation-triangle',
          acceptClassName: 'p-button-danger',
          accept: () => performDelete(row),
        });
        return;
      }
      confirmDialog({
        header: 'Delete transaction',
        message: 'Are you sure you want to delete this transaction? This cannot be undone.',
        icon: 'pi pi-exclamation-triangle',
        acceptClassName: 'p-button-danger',
        accept: () => performDelete(row),
      });
    },
    [canEditCategories, performDelete]
  );

  const performBulkDelete = useCallback(async (transactionsToDelete) => {
    const list = Array.isArray(transactionsToDelete) && transactionsToDelete.length > 0
      ? transactionsToDelete
      : selectedTransactions;
    if (list.length === 0) return;
    const tempIds = list.filter((t) => isNewRow(t.id)).map((t) => t.id);
    const persistedIds = list
      .filter((t) => !isNewRow(t.id))
      .map((t) => (typeof t.id === 'number' ? t.id : parseInt(t.id, 10)))
      .filter((id) => !Number.isNaN(id));

    setBulkDeleting(true);
    try {
      if (tempIds.length > 0) {
        setEditableTransactions((prev) => prev.filter((t) => !tempIds.includes(t.id)));
      }
      if (persistedIds.length > 0) {
        await axios.delete(`${apiBase}/transactions/bulk`, { data: { ids: persistedIds } });
        setEditableTransactions((prev) =>
          prev.filter((t) => {
            const id = typeof t.id === 'number' ? t.id : parseInt(t.id, 10);
            return !persistedIds.includes(id);
          })
        );
      }
      setSelectedTransactions([]);
      if (editingRowId != null) {
        const deletedIds = [...tempIds, ...persistedIds.map(String)];
        if (deletedIds.includes(String(editingRowId))) setEditingRowId(null);
      }
    } catch (err) {
      console.error('Bulk delete error:', err);
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedTransactions, editingRowId]);

  const handleBulkDelete = useCallback(() => {
    if (!canEditCategories || selectedTransactions.length === 0) return;
    const toDelete = [...selectedTransactions];
    const count = toDelete.length;
    confirmDialog({
      header: 'Delete selected transactions',
      message: `Are you sure you want to delete ${count} selected transaction${count !== 1 ? 's' : ''}? This cannot be undone.`,
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => performBulkDelete(toDelete),
    });
  }, [canEditCategories, selectedTransactions, performBulkDelete]);

  // Apply group, type (debit/credit), and search filters (group from DB via getCategoryGroup)
  // Include editingRowId in deps so table value reference changes when edit mode toggles (forces row cells to re-render)
  const filteredTransactions = useMemo(() => {
    let rows = editableTransactions || [];

    if (activeGroup && activeGroup !== 'ALL') {
      rows = rows.filter((t) => getCategoryGroup(t.categoryName) === activeGroup);
    }

    if (categoryNameFilter && categoryNameFilter !== 'ALL') {
      const catNorm = (name) => (name != null ? String(name).trim() : '') || 'Uncategorized';
      const filterCat = catNorm(categoryNameFilter).toLowerCase();
      rows = rows.filter((t) => catNorm(t.categoryName).toLowerCase() === filterCat);
    }

    if (typeFilter && typeFilter !== 'all') {
      const typeNorm = (t) => (t.type || '').toString().trim().toLowerCase();
      if (typeFilter === 'debit') {
        rows = rows.filter((t) => typeNorm(t) === 'debit' || typeNorm(t) === 'dr');
      } else if (typeFilter === 'credit') {
        rows = rows.filter((t) => typeNorm(t) === 'credit' || typeNorm(t) === 'cr');
      }
    }

    if (searchTerm && searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      rows = rows.filter((t) => {
        const desc = (t.description || '').toLowerCase();
        const cat = (t.categoryName || '').toLowerCase();
        const amt = t.amount != null ? String(t.amount).toLowerCase() : '';
        return desc.includes(q) || cat.includes(q) || amt.includes(q);
      });
    }

    return rows;
  }, [editableTransactions, activeGroup, categoryNameFilter, typeFilter, searchTerm, getCategoryGroup]);

  // Reset to first page when filters change so serial numbers and rows stay correct
  useEffect(() => {
    setPaginationState((prev) => (prev.first === 0 ? prev : { ...prev, first: 0 }));
  }, [activeGroup, categoryNameFilter, typeFilter, searchTerm]);

  const typeFilterOptions = [
    { label: 'All', value: 'all' },
    { label: 'Debit', value: 'debit' },
    { label: 'Credit', value: 'credit' },
  ];

  const categoryFilterOptions = useMemo(
    () => [
      { label: 'All categories', value: 'ALL' },
      ...categoryGroups.map((g) => ({ label: g.name, value: g.name })),
      ...(categoryGroups.some((g) => g.name === 'Others') ? [] : [{ label: 'Others', value: 'Others' }]),
    ],
    [categoryGroups]
  );

  const categoryNameFilterOptions = useMemo(
    () => [
      { label: 'All categories', value: 'ALL' },
      ...categoryOptions
        .filter((o) => o.value)
        .map((o) => ({ label: o.label, value: o.value })),
    ],
    [categoryOptions]
  );

  const uncategorizedTransactions = useMemo(() => {
    return (editableTransactions || []).filter(
      (t) =>
        !isNewRow(t.id) &&
        ((t.categoryName ?? t.category_name ?? '').toString().trim().toLowerCase() === 'uncategorized' ||
          !(t.categoryName ?? t.category_name ?? '').toString().trim())
    );
  }, [editableTransactions]);

  const handleDownloadUncategorized = useCallback(async () => {
    if (uncategorizedTransactions.length === 0) return;
    setExcelDownloading(true);
    try {
      await downloadUncategorizedExcel(uncategorizedTransactions, categoryOptions);
    } catch (err) {
      console.error('Download uncategorized Excel error:', err);
    } finally {
      setExcelDownloading(false);
    }
  }, [uncategorizedTransactions, categoryOptions]);

  const handleUploadSheet = useCallback(
    async (e) => {
      const file = e?.target?.files?.[0];
      if (e?.target) e.target.value = '';
      if (!file) return;
      if (!canEditCategories) {
        setUploadProgressMessage('Editing is not allowed in this state.');
        setTimeout(() => setUploadProgressMessage(null), 4000);
        return;
      }

      const validIds = (editableTransactions || [])
        .filter((t) => !isNewRow(t.id))
        .map((t) => (typeof t.id === 'number' ? t.id : parseInt(t.id, 10)))
        .filter((id) => !Number.isNaN(id));
      const validCategories = categoryOptions || [];

      setExcelUploading(true);
      setUploadProgressMessage('Reading file...');
      try {
        setUploadProgressMessage('Validating rows...');
        const result = await parseAndValidateUploadedSheet(file, validIds, validCategories);
        const { rows, errors, errorRows, workbook } = result;

        if (errorRows.size > 0 && workbook) {
          setUploadProgressMessage(`Validation failed (${errorRows.size} row(s)). Downloading error file...`);
          await downloadErrorExcel(workbook, errorRows, errors, result.sheet);
          setUploadProgressMessage('Error file downloaded. Fix the red rows and upload again.');
          setTimeout(() => setUploadProgressMessage(null), 6000);
          return;
        }

        const validRows = rows.filter((r) => !r.error && r.id != null && r.category);
        if (validRows.length === 0) {
          setUploadProgressMessage('No valid rows to update. Check that Id and Category columns are filled.');
          setTimeout(() => setUploadProgressMessage(null), 5000);
          return;
        }

        const total = validRows.length;
        let updated = 0;
        for (const row of validRows) {
          setUploadProgressMessage(`Updating categories (${updated + 1}/${total})...`);
          try {
            await axios.patch(`${apiBase}/transactions/${row.id}/category`, {
              categoryId: resolveCategoryId(row.category),
              categoryName: row.category,
            });
            updated += 1;
          } catch (err) {
            console.error('Update category error for id', row.id, err);
          }
        }

        const idMatch = (rId, tId) => {
          const r = Number(rId);
          const t = Number(tId);
          if (!Number.isNaN(r) && !Number.isNaN(t)) return r === t;
          return String(rId) === String(tId);
        };
        setEditableTransactions((prev) =>
          prev.map((t) => {
            const match = validRows.find((r) => idMatch(r.id, t.id));
            if (!match) return t;
            return { ...t, categoryName: match.category, categoryId: resolveCategoryId(match.category) };
          })
        );
        setUploadProgressMessage(`${updated} transaction(s) updated successfully.`);
        setTimeout(() => setUploadProgressMessage(null), 4000);
        onCategoriesUpdated?.();
      } catch (err) {
        console.error('Upload sheet error:', err);
        setUploadProgressMessage('Invalid or corrupted file. Use the template from "Download uncategorized" and try again.');
        setTimeout(() => setUploadProgressMessage(null), 6000);
        alert('Invalid or corrupted Excel file. Please use the template from "Download uncategorized" and upload again.');
      } finally {
        setExcelUploading(false);
      }
    },
    [canEditCategories, editableTransactions, categoryOptions, resolveCategoryId, onCategoriesUpdated]
  );

  // When submitted/completed, only RM sees read-only; TL/Admin can still edit in approval view.
  const isReadOnly =
    (uploadStatus === 'submitted' || uploadStatus === 'completed') && !isAdminOrTL;

  return (
    <div className="transaction-review-container transaction-review-preview-style">
      <ConfirmDialog className="review-confirm-dialog" />

      {isReadOnly && (
        <div className="review-readonly-banner" role="status">
          <span className="review-readonly-banner-icon" aria-hidden="true">🔒</span>
          <span>
            {uploadStatus === 'completed'
              ? 'This budget has been approved. No edits are allowed.'
              : 'This budget is submitted for approval. No edits are allowed.'}
          </span>
        </div>
      )}

      <div className="review-layout-two-col">
        <div className="review-left-col">
          <h2 className="review-heading">Review Transactions</h2>
          <p className="review-description">
            Review categorizations and view analytics.
          </p>
          {!isReadOnly && (
            <div className="review-info-card review-important-alert">
              <svg className="review-info-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span><strong>Important:</strong> Category changes are saved automatically.</span>
            </div>
          )}
        </div>
        <div className="review-filters-box">
          <h3 className="review-filters-box-title">Categorization Filters</h3>
          <div className="review-filters-box-inner">
            <input
              type="text"
              className="review-search-input"
              placeholder="Search description"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={isReadOnly}
            />
            <div className="review-category-dropdown-wrap review-filter-group">
              <label htmlFor="review-category-group-filter" className="review-category-dropdown-label">
                Group
              </label>
              <Autocomplete
                id="review-category-group-filter"
                value={categoryFilterOptions.find((o) => o.value === activeGroup) || categoryFilterOptions[0]}
                options={categoryFilterOptions}
                getOptionLabel={(opt) => opt?.label ?? ''}
                isOptionEqualToValue={(opt, val) => opt.value === val.value}
                onChange={(e, newValue) => setActiveGroup(newValue?.value ?? 'ALL')}
                disabled={isReadOnly}
                renderInput={(params) => (
                  <TextField {...params} placeholder="All groups" size="small" className="review-category-mui-input" />
                )}
                className="review-category-autocomplete"
                sx={{ minWidth: 180, width: 200 }}
              />
            </div>
            <div className="review-category-dropdown-wrap review-filter-category">
              <label htmlFor="review-category-name-filter" className="review-category-dropdown-label">
                Category
              </label>
              <Autocomplete
                id="review-category-name-filter"
                value={categoryNameFilterOptions.find((o) => o.value === categoryNameFilter) || categoryNameFilterOptions[0]}
                options={categoryNameFilterOptions}
                getOptionLabel={(opt) => opt?.label ?? ''}
                isOptionEqualToValue={(opt, val) => opt.value === val.value}
                onChange={(e, newValue) => setCategoryNameFilter(newValue?.value ?? 'ALL')}
                disabled={isReadOnly}
                renderInput={(params) => (
                  <TextField {...params} placeholder="All categories" size="small" className="review-category-mui-input" />
                )}
                className="review-category-autocomplete"
                sx={{ minWidth: 200, width: 220 }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="review-actions-row">
        {canEditCategories && selectedTransactions.length > 0 && (
          <Button
            label={bulkDeleting ? 'Deleting...' : `Delete selected (${selectedTransactions.length})`}
            icon={bulkDeleting ? 'pi pi-spin pi-spinner' : 'pi pi-trash'}
            className="review-btn-bulk-delete p-button-danger p-button-outlined"
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
          />
        )}
        {canEditCategories && (
          <>
            <Button
              label={excelDownloading ? 'Preparing...' : `Download uncategorized (${uncategorizedTransactions.length})`}
              icon={excelDownloading ? 'pi pi-spin pi-spinner' : 'pi pi-download'}
              className="review-btn-excel p-button-outlined"
              onClick={handleDownloadUncategorized}
              disabled={excelDownloading || uncategorizedTransactions.length === 0}
              title="Download uncategorized transactions as Excel with category dropdown"
            />
            <Button
              label={excelUploading ? 'Uploading...' : 'Upload sheet'}
              icon={excelUploading ? 'pi pi-spin pi-spinner' : 'pi pi-upload'}
              className="review-btn-excel-upload p-button-outlined"
              onClick={() => uploadSheetInputRef.current?.click()}
              disabled={excelUploading}
              title="Upload filled Excel to apply categories"
            />
            <input
              ref={uploadSheetInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="review-upload-sheet-input"
              onChange={handleUploadSheet}
              aria-label="Upload categorization sheet"
            />
          </>
        )}
        <div className="review-actions-row-right">
          {canEditCategories && uploadId && (
            <Button
              label="Add new record"
              icon="pi pi-plus"
              className="review-btn-add-new"
              onClick={() => {
                const newId = `new-${Date.now()}`;
                const defaultDate =
                  budgetMonthRange.min ??
                  new Date().toISOString().slice(0, 10);
                const newRow = {
                  id: newId,
                  date: defaultDate,
                  description: '',
                  amount: '',
                  type: 'Debit',
                  categoryName: 'Uncategorized',
                  categoryId: null,
                };
                setEditableTransactions((prev) => [newRow, ...prev]);
                setEditingRowId(newId);
                setActiveGroup('ALL');
              }}
            />
          )}
          <div className="review-actions-row-type">
          <label htmlFor="review-type-filter" className="review-category-dropdown-label">
            Type
          </label>
          <Autocomplete
            id="review-type-filter"
            value={typeFilterOptions.find((o) => o.value === typeFilter) || typeFilterOptions[0]}
            options={typeFilterOptions}
            getOptionLabel={(opt) => opt?.label ?? ''}
            isOptionEqualToValue={(opt, val) => opt.value === val.value}
            onChange={(e, newValue) => setTypeFilter(newValue?.value ?? 'all')}
            disabled={isReadOnly}
            renderInput={(params) => (
              <TextField {...params} placeholder="All" size="small" className="review-category-mui-input" />
            )}
            className="review-category-autocomplete"
            sx={{ minWidth: 90, width: 100 }}
          />
          </div>
        </div>
      </div>

      {(excelUploading || uploadProgressMessage) && (
        <div
          className={`review-upload-progress ${excelUploading ? 'review-upload-progress-active' : ''}`}
          role="status"
          aria-live="polite"
        >
          {excelUploading && <span className="review-upload-progress-spinner" aria-hidden="true" />}
          <span className="review-upload-progress-text">{uploadProgressMessage || 'Processing...'}</span>
        </div>
      )}

      <div className="transactions-table-container review-table-wrap">
        <DataTable
            key={`review-${editingRowId ?? 'none'}`}
            value={filteredTransactions}
            paginator
            first={paginationState.first}
            rows={paginationState.rows}
            onPage={(e) => setPaginationState({ first: e.first, rows: e.rows })}
            rowsPerPageOptions={[10, 20, 50, 100]}
            stripedRows
            responsiveLayout="scroll"
            dataKey="id"
            paginatorClassName="review-paginator"
            paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown"
            selection={canEditCategories ? selectedTransactions : undefined}
            onSelectionChange={canEditCategories ? (e) => setSelectedTransactions(e.value) : undefined}
            selectionMode={canEditCategories ? 'multiple' : undefined}
          >
            {canEditCategories && (
              <Column
                selectionMode="multiple"
                style={{ width: '3rem', flexShrink: 0 }}
                className="review-selection-column"
              />
            )}
            <Column
              header="Sr. No."
              body={serialNumberBody}
              style={{ width: '56px' }}
            />
            <Column
              field="date"
              header="Date"
              sortable
              body={dateBodyTemplate}
            />
            <Column
              field="description"
              header="Description"
              sortable
              body={descriptionBodyTemplate}
              style={{ minWidth: '280px', width: '30%' }}
            />
            <Column
              field="amount"
              header="Amount"
              sortable
              body={amountBodyTemplate}
              className="review-amount-column"
              headerStyle={{ textAlign: 'left' }}
              bodyStyle={{ textAlign: 'left' }}
            />
            <Column
              field="type"
              header="Type"
              sortable
              body={typeBodyTemplate}
            />
            <Column
              field="categoryName"
              header="Category"
              body={categoryBodyTemplate}
            />
            {canEditCategories && (
              <Column
                header="Actions"
                body={actionsBodyTemplate}
                className="review-actions-column"
                style={{ width: '72px', minWidth: '72px' }}
              />
            )}
          </DataTable>
      </div>
    </div>
  );
};

export default TransactionReview;

