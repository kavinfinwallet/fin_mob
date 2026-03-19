import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import ColumnMapping from '../components/ColumnMapping';
import TransactionReview from '../components/TransactionReview';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Dialog } from 'primereact/dialog';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import { useAuth } from '../context/AuthContext';
import { useCustomer } from '../context/CustomerContext';
import { useToast } from '../context/ToastContext';
import { formatCurrency as formatCurrencyUtil } from '../constants/currencies';
import { formatTransactionDate } from '../utils/format';
import './Transactions.css';

const apiBase = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const SAVE_MAPPED_BATCH_SIZE = 100;

/** Call save-mapped API; if transactions.length > 100, splits into batches of 100 to avoid large payloads. */
async function saveMappedInBatches(baseUrl, uploadId, transactions) {
  if (transactions.length <= SAVE_MAPPED_BATCH_SIZE) {
    return axios.post(`${baseUrl}/transactions/save-mapped`, { uploadId, transactions });
  }
  const batches = [];
  for (let i = 0; i < transactions.length; i += SAVE_MAPPED_BATCH_SIZE) {
    batches.push(transactions.slice(i, i + SAVE_MAPPED_BATCH_SIZE));
  }
  for (let i = 0; i < batches.length; i++) {
    await axios.post(`${baseUrl}/transactions/save-mapped`, {
      uploadId,
      transactions: batches[i],
      batchIndex: i,
    });
  }
  return { status: 200, data: { message: 'Mapped transactions saved successfully', count: transactions.length } };
}

const Transactions = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedCustomerId, selectedCustomer } = useCustomer();
  const { toast } = useToast();
  const [step, setStep] = useState('upload'); // upload, preview, mapping, categorize, review
  const [uploadId, setUploadId] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [columnMapping, setColumnMapping] = useState(null);
  const [columnNames, setColumnNames] = useState([]); // Actual column names from PDF
  const [files, setFiles] = useState([]); // single file per upload
  const [password, setPassword] = useState('');
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const tabulaPdfUrl = process.env.REACT_APP_TABULA_PDF_URL || 'https://tabula.technology/';
  const [showPdfExtractModal, setShowPdfExtractModal] = useState(false);
  const [pdfExtractErrorMsg, setPdfExtractErrorMsg] = useState('');
  const showTabulaHelpModal = error === 'Error saving mapped transactions' || showPdfExtractModal;

  // Upload-level metadata: period (month/year), declared income, and goal for this upload
  const now = new Date();
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1); // 1-12
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [declaredIncome, setDeclaredIncome] = useState('');
  const [goalAmount, setGoalAmount] = useState('');
  const [showUploadConfirm, setShowUploadConfirm] = useState(false);
  const [uploadChecks, setUploadChecks] = useState({ fileOk: false, incomeGoalOk: false, statementOk: false });

  // Existing uploads (for selected customer + statement period)
  const [existingUploads, setExistingUploads] = useState([]);
  const [existingUploadsLoading, setExistingUploadsLoading] = useState(false);
  // When list API doesn't return income/goal, we fetch from resume endpoint
  const [existingMonthIncomeGoal, setExistingMonthIncomeGoal] = useState({ income: null, goal: null });

  // Uploads created in the current session (preview tabs)
  const [sessionUploads, setSessionUploads] = useState([]);
  const [activePreviewUploadId, setActivePreviewUploadId] = useState(null);

  // Review page: multi-select uploads → table data changes
  const [reviewUploadOptions, setReviewUploadOptions] = useState([]);
  const [selectedReviewUploadIds, setSelectedReviewUploadIds] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewDateRange, setReviewDateRange] = useState(null); // { min_date, max_date } from API

  // Mandatory fields for upload: statement month, year, monthly income, monthly goal, and file (uploadFormValid computed after hasExistingForMonth)

  const isExcelOrCsv = (f) => {
    if (!f || !f.name) return false;
    const n = f.name.toLowerCase();
    return n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.csv');
  };
  const isPdf = (f) => f && f.name && f.name.toLowerCase().endsWith('.pdf');

  // Common date format for transactions
  const formatDate = formatTransactionDate;

  const formatAmount = (amount) => formatCurrencyUtil(amount, selectedCustomer);

  // Handle resume from upload history or open review for month (from Budget History)
  useEffect(() => {
    if (location.state?.reviewForMonth) {
      const { periodMonth: pm, periodYear: py, uploadIds } = location.state;
      setStep('review');
      if (pm) setPeriodMonth(pm);
      if (py) setPeriodYear(py);
      if (Array.isArray(uploadIds) && uploadIds.length > 0) setSelectedReviewUploadIds(uploadIds);
      window.history.replaceState({}, document.title);
      return;
    }
    if (location.state?.resume) {
      const {
        uploadId: id,
        columnMapping: mapping,
        transactions: txns,
        currentStep,
        status,
        periodMonth: pm,
        periodYear: py,
        declaredIncome: di,
        goalAmount: ga,
        uploadIds: resumeUploadIds,
      } = location.state;
      setUploadId(id);
      setColumnMapping(mapping);
      setTransactions(txns || []);
      setStep(currentStep || 'review');
      setUploadStatus(status || '');
      if (Array.isArray(resumeUploadIds) && resumeUploadIds.length > 0) {
        setSelectedReviewUploadIds(resumeUploadIds);
      } else if (id) {
        setSelectedReviewUploadIds([id]);
      }
      if (pm != null) setPeriodMonth(pm);
      if (py != null) setPeriodYear(py);
      if (di !== undefined && di !== null) setDeclaredIncome(String(di));
      if (ga !== undefined && ga !== null) setGoalAmount(String(ga));
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // When entering review step, load upload options for the dropdown
  useEffect(() => {
    if (step !== 'review') return;
    const customerId = selectedCustomerId === null || selectedCustomerId === undefined ? '' : String(selectedCustomerId);
    if (!customerId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const params = new URLSearchParams();
        params.set('customer_id', customerId);
        params.set('tab', 'all');
        params.set('page', '1');
        params.set('limit', '50');
        params.set('period_month', String(periodMonth));
        params.set('period_year', String(periodYear));
        const res = await axios.get(`${apiBase}/transactions/uploads?${params.toString()}`);
        if (cancelled) return;
        const opts = (res.data.uploads || []).map((u) => {
          const name = u.file_name || '';
          const short = name.length > 28 ? name.slice(0, 25) + '…' : name;
          return {
            label: `${u.file_name} (id: ${u.id}, ${u.status})`,
            shortLabel: short,
            value: u.id,
          };
        });
        setReviewUploadOptions(opts);
        // Sync upload status from server so review is read-only when month has submitted/completed uploads
        const uploads = res.data.uploads || [];
        if (uploads.length > 0) {
          const statuses = uploads.map((u) => u.status);
          if (statuses.some((s) => s === 'submitted')) setUploadStatus('submitted');
          else if (statuses.some((s) => s === 'completed')) setUploadStatus('completed');
          else if (statuses.some((s) => s === 'rejected')) setUploadStatus('rejected');
          else setUploadStatus(uploads[0].status || '');
        }
        // Always show all uploads for this month (re-upload same month = new + old combined)
        if (opts.length > 0) {
          setSelectedReviewUploadIds(opts.map((o) => o.value));
        } else if (uploadId) {
          setSelectedReviewUploadIds([uploadId]);
        }
      } catch {
        if (!cancelled) setReviewUploadOptions([]);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [step, selectedCustomerId, periodMonth, periodYear]);

  // When selected uploads change on review step, fetch combined transactions
  useEffect(() => {
    if (step !== 'review' || !selectedReviewUploadIds || selectedReviewUploadIds.length === 0) return;
    let cancelled = false;
    const load = async () => {
      try {
        setReviewLoading(true);
        const ids = selectedReviewUploadIds.join(',');
        // status=all so we show old (approved) + new (pending) transactions for the month
        const res = await axios.get(`${apiBase}/transactions/uploads/transactions?upload_ids=${ids}&status=all`);
        if (cancelled) return;
        const raw = (res.data.transactions || []).map((t) => ({
          ...t,
          category_name: t.category_name || t.categoryName || 'Uncategorized',
          category_id: t.category_id ?? t.categoryId,
        }));
        const list = raw.slice().sort((a, b) => {
          const dA = a.date ? String(a.date).slice(0, 10) : '';
          const dB = b.date ? String(b.date).slice(0, 10) : '';
          return dA.localeCompare(dB) || (a.id ?? 0) - (b.id ?? 0);
        });
        setTransactions(list);
        setReviewDateRange(res.data.date_range || null);
      } catch {
        if (!cancelled) setTransactions([]);
      } finally {
        if (!cancelled) setReviewLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [step, selectedReviewUploadIds]);

  const refetchReviewTransactions = useCallback(async () => {
    if (!selectedReviewUploadIds || selectedReviewUploadIds.length === 0) return;
    try {
      const ids = selectedReviewUploadIds.join(',');
      const res = await axios.get(`${apiBase}/transactions/uploads/transactions?upload_ids=${ids}&status=all`);
      const raw = (res.data.transactions || []).map((t) => ({
        ...t,
        category_name: t.category_name || t.categoryName || 'Uncategorized',
        category_id: t.category_id ?? t.categoryId,
      }));
      const list = raw.slice().sort((a, b) => {
        const dA = a.date ? String(a.date).slice(0, 10) : '';
        const dB = b.date ? String(b.date).slice(0, 10) : '';
        return dA.localeCompare(dB) || (a.id ?? 0) - (b.id ?? 0);
      });
      setTransactions(list);
    } catch (err) {
      console.error('Refetch review transactions error:', err);
    }
  }, [selectedReviewUploadIds]);

  const handleFileChange = (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) {
      setFiles([]);
      return;
    }
    const first = picked[0];
    const name = (first?.name || '').toLowerCase();
    const allowed =
      name.endsWith('.pdf') || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')
        ? [first]
        : [];
    if (allowed.length === 0) {
      setError('Please select a PDF or Excel/CSV file');
      setFiles([]);
      return;
    }
    if (picked.length > 1) {
      setError('Only one file can be processed per upload. Please select a single file.');
      setFiles([]);
      return;
    }
    setFiles(allowed);
    setError('');
  };

  // Load existing uploads for the selected customer + month/year (table in upload step)
  useEffect(() => {
    const customerId = selectedCustomerId === null || selectedCustomerId === undefined ? '' : String(selectedCustomerId);
    if (!customerId) {
      setExistingUploads([]);
      return;
    }
    const controller = new AbortController();
    const load = async () => {
      try {
        setExistingUploadsLoading(true);
        const params = new URLSearchParams();
        params.set('customer_id', customerId);
        params.set('tab', 'all');
        params.set('page', '1');
        params.set('limit', '50');
        params.set('period_month', String(periodMonth));
        params.set('period_year', String(periodYear));
        const res = await axios.get(`${apiBase}/transactions/uploads?${params.toString()}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setExistingUploads(res.data.uploads || []);
      } catch (err) {
        if (axios.isCancel(err) || err.name === 'AbortError') return;
        setExistingUploads([]);
      } finally {
        if (!controller.signal.aborted) setExistingUploadsLoading(false);
      }
    };
    load();
    return () => controller.abort();
  }, [selectedCustomerId, periodMonth, periodYear]);

  // When list doesn't return income/goal, fetch from resume endpoint for the first upload
  useEffect(() => {
    if (!Array.isArray(existingUploads) || existingUploads.length === 0) {
      setExistingMonthIncomeGoal({ income: null, goal: null });
      return;
    }
    const hasFromList = existingUploads.some((u) => {
      const i = u?.declared_income ?? u?.declaredIncome;
      const g = u?.goal_amount ?? u?.goalAmount;
      return (i != null && i !== '') || (g != null && g !== '');
    });
    if (hasFromList) {
      setExistingMonthIncomeGoal({ income: null, goal: null });
      return;
    }
    const firstId = existingUploads[0]?.id;
    if (!firstId) return;
    let cancelled = false;
    axios
      .get(`${apiBase}/transactions/uploads/${firstId}/resume`)
      .then((res) => {
        if (cancelled) return;
        const income = res.data?.declaredIncome ?? res.data?.declared_income;
        const goal = res.data?.goalAmount ?? res.data?.goal_amount;
        setExistingMonthIncomeGoal({
          income: income != null && income !== '' ? String(income) : null,
          goal: goal != null && goal !== '' ? String(goal) : null,
        });
      })
      .catch(() => {
        if (!cancelled) setExistingMonthIncomeGoal({ income: null, goal: null });
      });
    return () => { cancelled = true; };
  }, [existingUploads, apiBase]);

  // When month has existing uploads, prefill income and goal from first upload and disable the fields
  const hasExistingForMonth = Array.isArray(existingUploads) && existingUploads.length > 0;
  // Prefer first upload that has income/goal from list; fallback to resume-fetched values
  const firstWithIncomeGoal = hasExistingForMonth
    ? existingUploads.find((u) => {
        const i = u?.declared_income ?? u?.declaredIncome;
        const g = u?.goal_amount ?? u?.goalAmount;
        return (i != null && i !== '') || (g != null && g !== '');
      })
    : null;
  const firstExistingUpload = firstWithIncomeGoal || (hasExistingForMonth ? existingUploads[0] : null);
  const existingIncomeRaw =
    firstExistingUpload?.declared_income ?? firstExistingUpload?.declaredIncome ?? existingMonthIncomeGoal.income;
  const existingGoalRaw =
    firstExistingUpload?.goal_amount ?? firstExistingUpload?.goalAmount ?? existingMonthIncomeGoal.goal;
  const existingIncomeDisplay = existingIncomeRaw != null && existingIncomeRaw !== '' ? String(existingIncomeRaw) : '';
  const existingGoalDisplay = existingGoalRaw != null && existingGoalRaw !== '' ? String(existingGoalRaw) : '';

  // When month has existing uploads, use their income/goal for form validation
  const effectiveIncome = hasExistingForMonth ? existingIncomeDisplay : declaredIncome;
  const effectiveGoal = hasExistingForMonth ? existingGoalDisplay : goalAmount;
  const effectiveIncomeNum = effectiveIncome !== '' ? parseFloat(effectiveIncome) : NaN;
  const effectiveGoalNum = effectiveGoal !== '' ? parseFloat(effectiveGoal) : NaN;
  const uploadFormValid =
    periodMonth >= 1 && periodMonth <= 12 &&
    periodYear >= 2000 && periodYear <= 2100 &&
    !Number.isNaN(effectiveIncomeNum) && effectiveIncomeNum >= 0 &&
    !Number.isNaN(effectiveGoalNum) && effectiveGoalNum >= 0 &&
    Array.isArray(files) && files.length > 0;

  // Show Review button only when every upload for this month is processed (none in progress)
  const isUploadInProcess = (u) => u.status === 'processing' || u.currentStep === 'upload';
  const allProcessedForCurrentPeriod =
    hasExistingForMonth &&
    existingUploads.every((u) => !isUploadInProcess(u));

  useEffect(() => {
    if (!hasExistingForMonth) return;
    setDeclaredIncome(existingIncomeDisplay);
    setGoalAmount(existingGoalDisplay);
  }, [hasExistingForMonth, existingIncomeDisplay, existingGoalDisplay]);

  // Helper: map API transactions into the UI's canonical fields
  const mapApiTransactions = useCallback((apiTransactions) => {
    const parseAmount = (value) => {
      if (!value && value !== 0) return 0;
      const cleaned = String(value).replace(/,/g, '');
      const parsed = parseFloat(cleaned);
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    return (apiTransactions || [])
      .filter((txn) => {
        const dateValue = txn.date;
        if (!dateValue || dateValue === null || dateValue === undefined) return false;
        const dateStr = String(dateValue).trim().toLowerCase();
        if (dateStr === 'none' || dateStr === '-' || dateStr === '') return false;
        return true;
      })
      .map((txn) => {
        const amountNum = parseAmount(txn.amount);
        const typeRaw = (txn.type || '').toString().toLowerCase();
        const isCredit = typeRaw === 'credit';
        const isDebit = typeRaw === 'debit';
        const creditAmount = isCredit ? amountNum : null;
        const debitAmount = isDebit ? amountNum : null;
        let transactionType = '';
        if (isCredit) transactionType = 'credit';
        else if (isDebit) transactionType = 'debit';
        else transactionType = amountNum >= 0 ? 'credit' : 'debit';
        const rawData = { ...txn };
        return {
          date: txn.date,
          description: txn.description,
          amount: amountNum,
          type: transactionType,
          credit: creditAmount,
          debit: debitAmount,
          rawData,
        };
      });
  }, []);

  const uploadSinglePdf = useCallback(async (customerId, f) => {
    const incomeVal = hasExistingForMonth ? existingIncomeDisplay : declaredIncome;
    const goalVal = hasExistingForMonth ? existingGoalDisplay : goalAmount;
    const formData = new FormData();
    formData.append('pdf', f);
    formData.append('customerId', customerId);
    if (password) formData.append('password', password);
    formData.append('periodMonth', String(periodMonth));
    formData.append('periodYear', String(periodYear));
    if (incomeVal !== '') formData.append('declaredIncome', String(incomeVal));
    if (goalVal !== '') formData.append('goalAmount', String(goalVal));

    const response = await axios.post(`${apiBase}/transactions/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    const mappedTransactions = mapApiTransactions(response.data.transactions || []);

    if (mappedTransactions.length > 0) {
      try {
        const saveMappedRes = await saveMappedInBatches(apiBase, response.data.uploadId, mappedTransactions);
        if (saveMappedRes.status !== 200) {
          const msg = saveMappedRes.data?.message || saveMappedRes.data?.detail || 'Error saving mapped transactions';
          setPdfExtractErrorMsg(typeof msg === 'string' ? msg : JSON.stringify(msg));
          setShowPdfExtractModal(true);
          throw new Error(msg);
        }
      } catch (saveMappedErr) {
        const msg = saveMappedErr?.response?.data?.message || saveMappedErr?.response?.data?.detail || 'Error saving mapped transactions';
        setPdfExtractErrorMsg(typeof msg === 'string' ? msg : JSON.stringify(msg));
        setShowPdfExtractModal(true);
        throw saveMappedErr;
      }
    }

    return {
      uploadId: response.data.uploadId,
      fileName: f.name,
      transactions: mappedTransactions,
      columnMapping: response.data.detectedColumns,
      columnNames: response.data.columnNames || [],
      uploadStatus: 'mapped',
    };
  }, [declaredIncome, goalAmount, existingIncomeDisplay, existingGoalDisplay, hasExistingForMonth, mapApiTransactions, password, periodMonth, periodYear]);

  const uploadSingleExcelOrCsv = useCallback(async (customerId, f) => {
    const fastApiUrl = (process.env.REACT_APP_FASTAPI_URL || 'http://localhost:8000').replace(/\/$/, '');
    const formData = new FormData();
    formData.append('file', f);
    formData.append('sheet_name', 'Sheet1');
    const tabulaRes = await axios.post(`${fastApiUrl}/tabula-extract-data`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    const apiTransactions = tabulaRes.data.transactions || [];
    const columnsMapping = tabulaRes.data.columns_mapping || {};
    const columnNamesFromMapping = Object.values(columnsMapping).filter(Boolean);
    const mappedTransactions = mapApiTransactions(apiTransactions);

    const incomeVal = hasExistingForMonth ? existingIncomeDisplay : declaredIncome;
    const goalVal = hasExistingForMonth ? existingGoalDisplay : goalAmount;
    const saveRes = await axios.post(
      `${apiBase}/transactions/save-tabula-upload`,
      {
        customerId,
        fileName: f.name,
        columns_mapping: columnsMapping,
        periodMonth,
        periodYear,
        declaredIncome: incomeVal === '' ? null : incomeVal,
        goalAmount: goalVal === '' ? null : goalVal,
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (mappedTransactions.length > 0) {
      try {
        const saveMappedRes = await saveMappedInBatches(apiBase, saveRes.data.uploadId, mappedTransactions);
        if (saveMappedRes.status !== 200) {
          const msg = saveMappedRes.data?.message || saveMappedRes.data?.detail || 'Error saving mapped transactions';
          setPdfExtractErrorMsg(typeof msg === 'string' ? msg : JSON.stringify(msg));
          setShowPdfExtractModal(true);
          throw new Error(msg);
        }
      } catch (saveMappedErr) {
        const msg = saveMappedErr?.response?.data?.message || saveMappedErr?.response?.data?.detail || 'Error saving mapped transactions';
        setPdfExtractErrorMsg(typeof msg === 'string' ? msg : JSON.stringify(msg));
        setShowPdfExtractModal(true);
        throw saveMappedErr;
      }
    }

    return {
      uploadId: saveRes.data.uploadId,
      fileName: f.name,
      transactions: mappedTransactions,
      columnMapping: saveRes.data.detectedColumns || columnsMapping,
      columnNames: saveRes.data.columnNames || columnNamesFromMapping,
      uploadStatus: 'mapped',
    };
  }, [declaredIncome, goalAmount, existingIncomeDisplay, existingGoalDisplay, hasExistingForMonth, mapApiTransactions, periodMonth, periodYear]);

  const handleUpload = async () => {
    if (!files || files.length === 0) {
      setError('Please select at least one file');
      return;
    }

    const customerId = selectedCustomerId === null || selectedCustomerId === undefined ? '' : String(selectedCustomerId);
    if (!customerId) {
      setError('Please select a customer from the navbar');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const created = [];
      for (const f of files) {
        const entry = isExcelOrCsv(f)
          ? await uploadSingleExcelOrCsv(customerId, f)
          : await uploadSinglePdf(customerId, f);
        created.push(entry);
      }

      setSessionUploads(created);
      const first = created[0] || null;
      if (first) {
        setActivePreviewUploadId(first.uploadId);
        setUploadId(first.uploadId);
        setTransactions(first.transactions || []);
        setColumnMapping(first.columnMapping || null);
        setColumnNames(first.columnNames || []);
      }
      setStep('preview');
      setUploadStatus('mapped');
      setPassword('');
      setShowPasswordInput(false);

      // Refresh existing uploads table so the user sees current month records
      setExistingUploads((prev) => {
        const merged = [...(prev || [])];
        created.forEach((c) => {
          if (!merged.some((u) => String(u.id) === String(c.uploadId))) {
            merged.unshift({
              id: c.uploadId,
              file_name: c.fileName,
              status: 'mapped',
              created_at: new Date().toISOString(),
              period_month: periodMonth,
              period_year: periodYear,
            });
          }
        });
        return merged;
      });
    } catch (err) {
      const errorMessage = err.response?.data?.message || 'Error uploading file';
      setError(errorMessage);
      
      // If error mentions password, show password input
      if (errorMessage.toLowerCase().includes('password') || 
          errorMessage.toLowerCase().includes('encrypted') ||
          errorMessage.toLowerCase().includes('protected') ||
          err.response?.data?.requiresPassword) {
        setShowPasswordInput(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleExcelTypeChoice = async (type) => {
    const file = files && files.length > 0 ? files[0] : null;
    if (!file || !isExcelOrCsv(file)) return;
    const customerId = selectedCustomerId === null || selectedCustomerId === undefined ? '' : String(selectedCustomerId);
    if (!customerId) {
      setError('Please select a customer from the navbar');
      return;
    }
    setLoading(true);
    setError('');
    let apiBase = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
    if (!apiBase.endsWith('/api')) apiBase = apiBase.replace(/\/?$/, '') + '/api';
    const fastApiUrl = (process.env.REACT_APP_FASTAPI_URL || 'http://localhost:8000').replace(/\/$/, '');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('sheet_name', 'Sheet1');
      const tabulaRes = await axios.post(`${fastApiUrl}/tabula-extract-data`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        // Process tabula response same as upload API response (same filter + map as PDF flow)
        const apiTransactions = tabulaRes.data.transactions || [];
        const columnsMapping = tabulaRes.data.columns_mapping || {};
        const columnNames = Object.values(columnsMapping).filter(Boolean);
        const mappedTransactions = apiTransactions
          .filter((txn) => {
            const dateValue = txn.date;
            if (!dateValue || dateValue === null || dateValue === undefined) return false;
            const dateStr = String(dateValue).trim().toLowerCase();
            if (dateStr === 'none' || dateStr === '-' || dateStr === '') return false;
            return true;
          })
          .map((txn) => {
            const parseAmount = (value) => {
              if (!value && value !== 0) return 0;
              const cleaned = String(value).replace(/,/g, '');
              const parsed = parseFloat(cleaned);
              return isNaN(parsed) ? 0 : parsed;
            };
            const amountNum = parseAmount(txn.amount);
            const typeRaw = (txn.type || '').toString().toLowerCase();
            const isCredit = typeRaw === 'credit';
            const isDebit = typeRaw === 'debit';
            const creditAmount = isCredit ? amountNum : null;
            const debitAmount = isDebit ? amountNum : null;
            let transactionType = isCredit ? 'credit' : isDebit ? 'debit' : (amountNum >= 0 ? 'credit' : 'debit');
            const rawData = { ...txn };
            return {
              date: txn.date,
              description: txn.description,
              amount: amountNum,
              type: transactionType,
              credit: creditAmount,
              debit: debitAmount,
              rawData,
            };
          });
        const saveRes = await axios.post(
          `${apiBase}/transactions/save-tabula-upload`,
          {
            customerId,
            fileName: file.name,
            columns_mapping: columnsMapping,
            periodMonth,
            periodYear,
            declaredIncome: declaredIncome === '' ? null : declaredIncome,
            goalAmount: goalAmount === '' ? null : goalAmount,
          },
          { headers: { 'Content-Type': 'application/json' } }
        );
        if (mappedTransactions.length > 0) {
          let saveMappedFailed = false;
          let saveMappedErrMsg = '';
          try {
            const saveMappedRes = await saveMappedInBatches(apiBase, saveRes.data.uploadId, mappedTransactions);
            if (saveMappedRes.status !== 200) {
              saveMappedFailed = true;
              saveMappedErrMsg = saveMappedRes?.data?.message || saveMappedRes?.data?.detail || 'Error saving mapped transactions';
            }
          } catch (saveMappedErr) {
            saveMappedFailed = true;
            saveMappedErrMsg = saveMappedErr?.response?.data?.message || saveMappedErr?.response?.data?.detail || 'Error saving mapped transactions';
          }
          if (saveMappedFailed) {
            setPdfExtractErrorMsg(typeof saveMappedErrMsg === 'string' ? saveMappedErrMsg : JSON.stringify(saveMappedErrMsg));
            setShowPdfExtractModal(true);
            setLoading(false);
            return;
          }
        }
        setUploadId(saveRes.data.uploadId);
        setTransactions(mappedTransactions);
        setColumnMapping(saveRes.data.detectedColumns || columnsMapping);
        setColumnNames(saveRes.data.columnNames || columnNames);
        setStep('preview');
        setUploadStatus('mapped');
    } catch (err) {
      const msg = err.response?.data?.detail || err.response?.data?.message || 'Error processing file';
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setLoading(false);
    }
  };

  const handleMappingComplete = async (mapping) => {
    setLoading(true);
    setError('');

    try {
      // Save column mapping
      await axios.post(
        `${process.env.REACT_APP_API_URL || 'http://localhost:5000/api'}/transactions/column-mapping`,
        {
          uploadId,
          columnMapping: mapping
        }
      );

      // Helper function to get value from transaction using column mapping key
      const getValueFromTransaction = (txn, mappingKey) => {
        if (!mappingKey) return null;
        
        // First, check direct properties (for flat format - transactions have properties directly)
        // This handles cases where transaction has "Transaction\nDate", "Particulars", etc. as direct properties
        if (txn[mappingKey]) {
          return txn[mappingKey];
        }
        
        // If mappingKey is a column key like "column_5", get the actual column name from columnNames
        if (mappingKey.startsWith('column_') && columnNames) {
          const index = parseInt(mappingKey.replace('column_', ''));
          if (!isNaN(index) && columnNames[index]) {
            const actualColumnName = columnNames[index];
            if (txn[actualColumnName]) {
              return txn[actualColumnName];
            }
          }
        }
        
        // Check rawData (for backward compatibility)
        if (txn.rawData && txn.rawData[mappingKey]) {
          return txn.rawData[mappingKey];
        }
        
        return null;
      };

      // Frame JSON based on column mapping keys and rawData for save-mapped API
      const mappedTransactions = transactions.map(txn => {
        // Get values using column mapping keys
        const dateValue = mapping.date ? getValueFromTransaction(txn, mapping.date) : '';
        const descriptionValue = mapping.description ? getValueFromTransaction(txn, mapping.description) : '';
        const creditValue = mapping.credit ? getValueFromTransaction(txn, mapping.credit) : null;
        const debitValue = mapping.debit ? getValueFromTransaction(txn, mapping.debit) : null;
        
        // Helper to clean and parse amount while preserving decimals
        const parseAmount = (value) => {
          if (!value) return null;
          // Remove commas but preserve decimal points
          const cleaned = String(value).replace(/,/g, '');
          const parsed = parseFloat(cleaned);
          return isNaN(parsed) ? null : parsed;
        };
        
        // Parse credit and debit values (preserve decimals)
        const creditAmount = creditValue ? parseAmount(creditValue) : null;
        const debitAmount = debitValue ? parseAmount(debitValue) : null;
        
        // Determine amount: use credit OR debit (whichever has a value)
        // Preserve decimal precision
        let amountValue = null;
        if (creditAmount !== null && creditAmount > 0) {
          amountValue = creditAmount;
        } else if (debitAmount !== null && debitAmount > 0) {
          amountValue = debitAmount;
        } else {
          amountValue = 0;
        }
        
        // Determine type: credit if credit has value, debit if debit has value
        let transactionType = '';
        if (creditAmount !== null && creditAmount > 0) {
          transactionType = 'credit';
        } else if (debitAmount !== null && debitAmount > 0) {
          transactionType = 'debit';
        } else {
          // Fallback: default to credit if no clear indication
          transactionType = 'credit';
        }

        // Build rawData - preserve all original transaction properties
        const rawData = {};
        
        // Preserve all original properties that aren't already mapped
        // This captures column names from API JSON like "Transaction\nDate", "Particulars", etc.
        Object.keys(txn).forEach(key => {
          if (!['date', 'description', 'amount', 'type', 'credit', 'debit', 'raw', 'rawData', 'id', 'categoryId', 'categoryName'].includes(key)) {
            rawData[key] = txn[key];
          }
        });
        
        // Also copy existing rawData if it exists (for backward compatibility)
        if (txn.rawData) {
          Object.assign(rawData, txn.rawData);
        }

        // Build the transaction JSON for save-mapped API
        const mappedTxn = {
          date: dateValue,
          description: descriptionValue,
          amount: amountValue,
          type: transactionType,
          credit: creditAmount,
          debit: debitAmount,
          // Preserve all rawData - this includes all original column names
          rawData: rawData
        };
        
        // Preserve page if it exists
        if (txn.page) {
          mappedTxn.page = txn.page;
        }

        return mappedTxn;
      });

      // Filter out transactions with invalid dates (null, "none", or "-")
      const validTransactions = mappedTransactions.filter(txn => {
        const dateValue = txn.date;
        // Check if date is null, undefined, "none", or "-"
        if (!dateValue || dateValue === null || dateValue === undefined) {
          return false;
        }
        const dateStr = String(dateValue).trim().toLowerCase();
        if (dateStr === 'none' || dateStr === '-' || dateStr === '') {
          return false;
        }
        return true;
      });

      console.log(`Filtered ${mappedTransactions.length - validTransactions.length} transactions with invalid dates`);

      // Save mapped transactions to database
      const apiBase = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
      let saveMappedFailed = false;
      let saveMappedErrMsg = '';
      try {
        const saveMappedRes = await saveMappedInBatches(apiBase, uploadId, validTransactions);
        if (saveMappedRes.status !== 200) {
          saveMappedFailed = true;
          saveMappedErrMsg = saveMappedRes?.data?.message || saveMappedRes?.data?.detail || 'Error saving mapped transactions';
        }
      } catch (saveMappedErr) {
        saveMappedFailed = true;
        saveMappedErrMsg = saveMappedErr?.response?.data?.message || saveMappedErr?.response?.data?.detail || 'Error saving mapped transactions';
      }

      if (saveMappedFailed) {
        setPdfExtractErrorMsg(saveMappedErrMsg);
        setShowPdfExtractModal(true);
        setLoading(false);
        return;
      }

      setColumnMapping(mapping);
      setTransactions(validTransactions);
      setStep('categorize');
      setUploadStatus('mapped');
    } catch (err) {
      setError(err.response?.data?.message || 'Error mapping transactions');
    } finally {
      setLoading(false);
    }
  };

  const handleCategorize = async () => {
    setLoading(true);
    setError('');

    try {
      const apiBase = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
      const res = await axios.post(`${apiBase}/transactions/categorize/queue`, { uploadId });

      if (res.data.resumed) {
        toast(res.data.message || 'Resumed existing failed job for this upload', 'success');
      } else if (res.data.alreadyInProgress) {
        toast(res.data.message || 'A job for this upload is already queued or in progress', 'info');
      } else {
        toast('Categorization job queued', 'success');
      }

      setUploadStatus('categorizing');
      navigate('/categorization-queue');
    } catch (err) {
      setError(err.response?.data?.message || 'Error queueing categorization');
      toast(err.response?.data?.message || 'Error queueing categorization', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleApproval = async (finalTransactions) => {
    setLoading(true);
    setError('');

    try {
      await axios.post(
        `${process.env.REACT_APP_API_URL || 'http://localhost:5000/api'}/transactions/save`,
        {
          uploadId,
          transactions: finalTransactions || transactions
        }
      );

      alert('Transactions saved successfully!');
      setStep('upload');
      setFiles([]);
      setUploadId(null);
      setTransactions([]);
      setColumnMapping(null);
      setUploadStatus('');
    } catch (err) {
      setError(err.response?.data?.message || 'Error saving transactions');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setFiles([]);
    setUploadId(null);
    setTransactions([]);
    setColumnMapping(null);
    setColumnNames([]);
    setError('');
    setUploadStatus('');
    setSessionUploads([]);
    setActivePreviewUploadId(null);
    const resetNow = new Date();
    setPeriodMonth(resetNow.getMonth() + 1);
    setPeriodYear(resetNow.getFullYear());
    setDeclaredIncome('');
    setGoalAmount('');
  };

  const handleSubmitForApproval = async (finalTransactions) => {
    setLoading(true);
    setError('');

    try {
      await axios.post(
        `${process.env.REACT_APP_API_URL || 'http://localhost:5000/api'}/transactions/submit`,
        {
          uploadId,
          transactions: finalTransactions || transactions
        }
      );

      alert('Transactions submitted for approval!');
      setUploadStatus('submitted');
    } catch (err) {
      setError(err.response?.data?.message || 'Error submitting for approval');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <Navbar />
      <div className="transactions-container">

        {error && <div className="error-message">{error}</div>}

        <Dialog
          header="Couldn't extract transactions from the PDF"
          visible={showTabulaHelpModal}
          onHide={() => { setError(''); setShowPdfExtractModal(false); setPdfExtractErrorMsg(''); }}
          footer={
            <div className="tabula-modal-footer">
              <a
                href={tabulaPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="tabula-btn-open"
              >
                Open Tabula PDF in a new tab
              </a>
              <button type="button" className="tabula-btn-close" onClick={() => { setError(''); setShowPdfExtractModal(false); setPdfExtractErrorMsg(''); }}>
                Close
              </button>
            </div>
          }
          className="tabula-help-dialog"
          style={{ width: '90vw', maxWidth: '440px' }}
        >
          <div className="tabula-help-content">
            <p className="tabula-help-intro">
              Use Tabula PDF to get a table export, then upload that file here.
            </p>
            <ol className="tabula-help-steps">
              <li>Upload your PDF in Tabula PDF.</li>
              <li>Map the tables (or click <strong>Auto-detect tables</strong>).</li>
              <li>Check that only the right table areas are selected.</li>
              <li>Click <strong>Export as CSV</strong>.</li>
              <li>Upload the CSV or Excel file in this system.</li>
            </ol>
          </div>
        </Dialog>

        {step === 'upload' && (
          <div className="upload-section">
            <div className="upload-card">
              <div className="upload-card-header">
                <div className="upload-card-header-left">
                  <h2>Upload Bank Statement</h2>
                  <p>Upload a PDF or Excel/CSV bank statement to extract and categorize transactions</p>
                </div>
                <div className="upload-card-header-right">
                  {selectedCustomer && (
                    <span className="upload-active-customer">
                      <span className="upload-active-customer-label">For</span>
                      <strong>{selectedCustomer.name}</strong>
                    </span>
                  )}
                </div>
              </div>

              <div className="upload-metadata-grid">
                <div className="upload-metadata-field">
                  <label htmlFor="period-month">Statement month <span className="required-asterisk">*</span></label>
                  <select
                    id="period-month"
                    className="upload-metadata-input"
                    value={periodMonth}
                    onChange={(e) => setPeriodMonth(parseInt(e.target.value, 10))}
                  >
                    <option value={1}>Jan</option>
                    <option value={2}>Feb</option>
                    <option value={3}>Mar</option>
                    <option value={4}>Apr</option>
                    <option value={5}>May</option>
                    <option value={6}>Jun</option>
                    <option value={7}>Jul</option>
                    <option value={8}>Aug</option>
                    <option value={9}>Sep</option>
                    <option value={10}>Oct</option>
                    <option value={11}>Nov</option>
                    <option value={12}>Dec</option>
                  </select>
                </div>
                <div className="upload-metadata-field">
                  <label htmlFor="period-year">Year <span className="required-asterisk">*</span></label>
                  <input
                    id="period-year"
                    type="number"
                    className="upload-metadata-input"
                    min="2000"
                    max="2100"
                    value={periodYear}
                    onChange={(e) => setPeriodYear(parseInt(e.target.value || now.getFullYear(), 10))}
                  />
                </div>
                <div className="upload-metadata-field">
                  <label htmlFor="declared-income">
                    Monthly income (customer given) <span className="required-asterisk">*</span>
                    {hasExistingForMonth && <span className="upload-existing-badge">From existing uploads</span>}
                  </label>
                  <input
                    id="declared-income"
                    type="number"
                    className="upload-metadata-input"
                    min="0"
                    step="0.01"
                    value={hasExistingForMonth ? existingIncomeDisplay : declaredIncome}
                    onChange={(e) => setDeclaredIncome(e.target.value)}
                    placeholder="e.g. 75000"
                    disabled={hasExistingForMonth}
                    readOnly={hasExistingForMonth}
                    aria-readonly={hasExistingForMonth}
                  />
                </div>
                <div className="upload-metadata-field">
                  <label htmlFor="goal-amount">
                    Monthly goal (savings/investment) <span className="required-asterisk">*</span>
                    {hasExistingForMonth && <span className="upload-existing-badge">From existing uploads</span>}
                  </label>
                  <input
                    id="goal-amount"
                    type="number"
                    className="upload-metadata-input"
                    min="0"
                    step="0.01"
                    value={hasExistingForMonth ? existingGoalDisplay : goalAmount}
                    onChange={(e) => setGoalAmount(e.target.value)}
                    placeholder="e.g. 20000"
                    disabled={hasExistingForMonth}
                    readOnly={hasExistingForMonth}
                    aria-readonly={hasExistingForMonth}
                  />
                </div>
              </div>
              <div className="file-upload">
                <div className="file-upload-label-row">
                  <span className="file-upload-label">Statement file <span className="required-asterisk">*</span></span>
                  <button
                    type="button"
                    className="sample-download-link"
                    onClick={async () => {
                      try {
                        const res = await fetch(`${process.env.REACT_APP_API_URL}/download/sample-sheet`);
                        if (!res.ok) throw new Error('File not found');
                        const blob = await res.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'manual_upload.xlsx';
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        window.URL.revokeObjectURL(url);
                      } catch {
                        toast('Could not download sample sheet. Please try again.', 'error');
                      }
                    }}
                  >
                    &#8595; Download sample sheet
                  </button>
                </div>
                <input
                  type="file"
                  id="pdf-upload"
                  accept=".pdf,.xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="file-input"
                />
                <label htmlFor="pdf-upload" className={`file-label${files && files.length > 0 ? ' has-file' : ''}`}>
                  {files && files.length > 0
                    ? files[0]?.name || '1 file selected'
                    : 'Choose PDF or Excel/CSV (one file per upload)'}
                </label>
              </div>

              {files && files.length > 0 && (
                <>
                  {files.some((f) => isPdf(f)) && (
                  <div className="password-section">
                    <label>
                      <input
                        type="checkbox"
                        checked={showPasswordInput}
                        onChange={(e) => {
                          setShowPasswordInput(e.target.checked);
                          if (!e.target.checked) {
                            setPassword('');
                          }
                        }}
                      />
                      <span>PDF is password protected</span>
                    </label>
                    {showPasswordInput && (
                      <div className="password-input">
                        <input
                          type="password"
                          placeholder="Enter PDF password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="password-field"
                          disabled={loading}
                        />
                      </div>
                    )}
                  </div>
                  )}
                  <div className="upload-submit-row">
                    <button
                      onClick={() => {
                        if (!uploadFormValid) {
                          toast('Please fill all mandatory fields: Statement month, Year, Monthly income, Monthly goal, and select a file.', 'error');
                          return;
                        }
                        setUploadChecks({ fileOk: false, incomeGoalOk: false, statementOk: false });
                        setShowUploadConfirm(true);
                      }}
                      className="btn-primary"
                      disabled={loading || !uploadFormValid}
                      title={!uploadFormValid ? 'Fill all mandatory fields to enable' : undefined}
                    >
                      {loading ? 'Uploading...' : 'Upload & Process'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {(existingUploadsLoading || (existingUploads && existingUploads.length > 0)) && (
              <div className="existing-uploads-panel">
                <div className="existing-uploads-header">
                  <strong>Existing uploads for this month</strong>
                  <span className="existing-uploads-subtitle">
                    {existingUploadsLoading ? 'Loading…' : `${existingUploads.length} upload(s) found`}
                  </span>
                </div>
                {!existingUploadsLoading && existingUploads.length > 0 && (
                  <div className="existing-uploads-table-wrap">
                    <table className="existing-uploads-table">
                      <thead>
                        <tr>
                          <th>File name</th>
                          <th>Status</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {existingUploads.map((u) => (
                          <tr key={u.id}>
                            <td>{u.file_name}</td>
                            <td>{u.status}</td>
                            <td>{u.created_at ? new Date(u.created_at).toLocaleString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {showUploadConfirm && (
          <div className="upload-confirm-overlay" onClick={() => setShowUploadConfirm(false)}>
            <div className="upload-confirm-modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="upload-confirm-title">Before you upload, please confirm</h3>
              <p className="upload-confirm-subtitle">Check each item below before proceeding.</p>

              <ul className="upload-confirm-checklist">
                <li
                  className={`upload-confirm-item ${uploadChecks.fileOk ? 'checked' : ''}`}
                  onClick={() => setUploadChecks((c) => ({ ...c, fileOk: !c.fileOk }))}
                >
                  <span className="upload-confirm-checkbox">{uploadChecks.fileOk ? '✓' : ''}</span>
                  <div>
                    <strong>File is not broken</strong>
                    <p>Make sure the PDF or Excel/CSV file opens correctly and is not corrupted.</p>
                  </div>
                </li>
                <li
                  className={`upload-confirm-item ${uploadChecks.incomeGoalOk ? 'checked' : ''}`}
                  onClick={() => setUploadChecks((c) => ({ ...c, incomeGoalOk: !c.incomeGoalOk }))}
                >
                  <span className="upload-confirm-checkbox">{uploadChecks.incomeGoalOk ? '✓' : ''}</span>
                  <div>
                    <strong>Monthly income &amp; goal are correct</strong>
                    <p>Verify that the monthly income and savings/investment goal are updated correctly.</p>
                  </div>
                </li>
                <li
                  className={`upload-confirm-item ${uploadChecks.statementOk ? 'checked' : ''}`}
                  onClick={() => setUploadChecks((c) => ({ ...c, statementOk: !c.statementOk }))}
                >
                  <span className="upload-confirm-checkbox">{uploadChecks.statementOk ? '✓' : ''}</span>
                  <div>
                    <strong>Statement matches selected month</strong>
                    <p>Confirm the statement period matches the month and year you have chosen.</p>
                  </div>
                </li>
              </ul>

              <div className="upload-confirm-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowUploadConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!uploadChecks.fileOk || !uploadChecks.incomeGoalOk || !uploadChecks.statementOk}
                  onClick={() => {
                    setShowUploadConfirm(false);
                    handleUpload();
                  }}
                >
                  Confirm &amp; Submit
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="preview-section">
            <div className="preview-section-header">
              <div className="preview-header-text">
                <h2 className="preview-heading">Preview Transaction</h2>
                <p className="preview-total">
                  Showing top 4 of <strong>{transactions.length}</strong> transactions
                </p>
                <p className="preview-verify-msg">
                  Just verify that the PDF transaction format was extracted properly with the preview transactions below.
                </p>
              </div>
              <div className="preview-actions">
                <button onClick={handleReset} className="btn-secondary" disabled={loading}>
                  Cancel
                </button>
                {activePreviewUploadId && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={loading}
                    onClick={async () => {
                      try {
                        setLoading(true);
                        await axios.delete(`${apiBase}/transactions/uploads/${activePreviewUploadId}`);
                        setExistingUploads((prev) =>
                          (prev || []).filter((u) => String(u.id) !== String(activePreviewUploadId))
                        );
                        const remaining = (sessionUploads || []).filter((u) => String(u.uploadId) !== String(activePreviewUploadId));
                        setSessionUploads(remaining);
                        const next = remaining[0] || null;
                        if (!next) {
                          handleReset();
                          return;
                        }
                        setActivePreviewUploadId(next.uploadId);
                        setUploadId(next.uploadId);
                        setTransactions(next.transactions || []);
                        setColumnMapping(next.columnMapping || null);
                        setColumnNames(next.columnNames || []);
                        toast('Upload removed', 'success');
                      } catch (err) {
                        toast(err.response?.data?.message || 'Failed to remove upload', 'error');
                      } finally {
                        setLoading(false);
                      }
                    }}
                  >
                    Remove this upload
                  </button>
                )}
                <button
                  onClick={() => setStep('categorize')}
                  className="btn-primary"
                  disabled={loading || transactions.length === 0}
                >
                  Next
                </button>
              </div>
            </div>

            {sessionUploads && sessionUploads.length > 1 && (
              <div className="multi-upload-tabs">
                {sessionUploads.map((u) => (
                  <button
                    key={u.uploadId}
                    type="button"
                    className={`multi-upload-tab ${String(u.uploadId) === String(activePreviewUploadId) ? 'active' : ''}`}
                    onClick={() => {
                      setActivePreviewUploadId(u.uploadId);
                      setUploadId(u.uploadId);
                      setTransactions(u.transactions || []);
                      setColumnMapping(u.columnMapping || null);
                      setColumnNames(u.columnNames || []);
                    }}
                    disabled={loading}
                    title={u.fileName}
                  >
                    {u.fileName}
                  </button>
                ))}
              </div>
            )}
            <div className="transactions-table-container preview-table-wrap">
              <DataTable
                value={transactions.slice(0, 4)}
                paginator={false}
                stripedRows
                responsiveLayout="scroll"
                dataKey="id"
              >
                <Column
                  field="date"
                  header="Date"
                  sortable
                  body={(rowData) => (rowData.date ? formatDate(rowData.date) : '—')}
                />
                <Column
                  field="description"
                  header="Description"
                  sortable
                  body={(rowData) => rowData.description || '-'}
                />
                <Column
                  field="amount"
                  header="Amount"
                  sortable
                  body={(rowData) => {
                    const value = rowData.amount;
                    if (value === null || value === undefined || value === '') return '-';
                    const numAmount =
                      typeof value === 'number'
                        ? value
                        : parseFloat(String(value).replace(/,/g, ''));
                    return Number.isNaN(numAmount) ? value : formatAmount(numAmount);
                  }}
                />
                <Column
                  field="type"
                  header="Type"
                  sortable
                  body={(rowData) => {
                    const type = rowData.type || '-';
                    return type
                      ? String(type).charAt(0).toUpperCase() + String(type).slice(1)
                      : '-';
                  }}
                />
              </DataTable>
            </div>
          </div>
        )}

        {step === 'mapping' && (
          <ColumnMapping
            transactions={transactions}
            detectedColumns={columnMapping}
            columnNames={columnNames}
            onComplete={handleMappingComplete}
            onCancel={handleReset}
            loading={loading}
          />
        )}

        {step === 'categorize' && (
          <div className="categorize-section">
            <div className="categorize-card">
              <h2>Categorize Transactions</h2>
              <p className="categorize-description">
                We'll use AI to automatically categorize your transactions based on their descriptions.
                This may take a few moments...
              </p>
              <div className="categorize-info">
                <p>Total transactions to categorize: <strong>{transactions.length}</strong></p>
                <p>This will be processed in batches for efficiency.</p>
              </div>
              <div className="categorize-actions">
                <button
                  type="button"
                  onClick={() => setStep('preview')}
                  className="btn-secondary"
                  disabled={loading}
                >
                  Back
                </button>
                <button onClick={handleReset} className="btn-secondary" disabled={loading}>
                  Cancel
                </button>
                <button onClick={handleCategorize} className="btn-primary" disabled={loading}>
                  {loading ? 'Categorizing...' : 'Start Categorization'}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'review' && (() => {
          const isAdminOrTL = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'TEAM_LEAD' || user?.is_super_admin;
          const reviewReadOnly = uploadStatus === 'completed' || (uploadStatus === 'submitted' && !isAdminOrTL);
          return (
          <div className="review-step-wrap">
            <div className="review-upload-selector">
              <div className="review-upload-selector-label">
                Select upload(s) to review
                {reviewUploadOptions.length > 0 && (
                  <button
                    type="button"
                    className="review-upload-select-all"
                    onClick={() => setSelectedReviewUploadIds(reviewUploadOptions.map((o) => o.value))}
                    disabled={reviewLoading || loading || reviewReadOnly}
                  >
                    Select all
                  </button>
                )}
              </div>
              <div className="review-dropdown-wrap review-upload-mui">
                <Autocomplete
                  multiple
                  value={reviewUploadOptions.filter((o) => (selectedReviewUploadIds || []).includes(o.value))}
                  options={reviewUploadOptions}
                  getOptionLabel={(opt) => opt?.label ?? ''}
                  isOptionEqualToValue={(opt, val) => opt.value === val.value}
                  disabled={reviewLoading || loading || reviewReadOnly}
                  onChange={(e, newValue) => setSelectedReviewUploadIds(newValue.map((o) => o.value))}
                  filterSelectedOptions
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      placeholder="Select upload"
                      size="small"
                      className="review-upload-mui-input"
                    />
                  )}
                  renderTags={(value) => {
                    if (value.length === 0) return null;
                    return (
                      <Chip
                        key="count"
                        label={`${value.length} upload${value.length !== 1 ? 's' : ''} selected`}
                        size="small"
                        onDelete={reviewReadOnly ? undefined : () => setSelectedReviewUploadIds([])}
                        className="review-upload-chip"
                      />
                    );
                  }}
                  className="review-upload-autocomplete"
                  sx={{ width: '100%' }}
                />
              </div>
              <button
                type="button"
                className="btn-secondary"
                disabled={reviewLoading || loading || reviewReadOnly}
                onClick={async () => {
                  const customerId = selectedCustomerId === null || selectedCustomerId === undefined ? '' : String(selectedCustomerId);
                  if (!customerId) return;
                  try {
                    setReviewLoading(true);
                    const params = new URLSearchParams();
                    params.set('customer_id', customerId);
                    params.set('tab', 'all');
                    params.set('page', '1');
                    params.set('limit', '50');
                    params.set('period_month', String(periodMonth));
                    params.set('period_year', String(periodYear));
                    const res = await axios.get(`${apiBase}/transactions/uploads?${params.toString()}`);
                    const opts = (res.data.uploads || []).map((u) => {
                      const name = u.file_name || '';
                      const short = name.length > 28 ? name.slice(0, 25) + '…' : name;
                      return {
                        label: `${u.file_name} (id: ${u.id}, ${u.status})`,
                        shortLabel: short,
                        value: u.id,
                      };
                    });
                    setReviewUploadOptions(opts);
                    if ((selectedReviewUploadIds || []).length === 0 && uploadId) {
                      setSelectedReviewUploadIds([uploadId]);
                    }
                  } catch {
                    setReviewUploadOptions([]);
                  } finally {
                    setReviewLoading(false);
                  }
                }}
              >
                Refresh
              </button>
              <div className="review-topbar-spacer" aria-hidden="true" />
              <div className="review-topbar-actions">
                <button type="button" className="btn-secondary" onClick={handleReset} disabled={reviewLoading || loading}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={reviewLoading || loading || transactions.length === 0}
                  onClick={() => {
                    const uid = selectedReviewUploadIds && selectedReviewUploadIds.length > 0 ? selectedReviewUploadIds[0] : null;
                    navigate('/upload-analytics', {
                      state: {
                        uploadId: uid,
                        transactions,
                        uploadStatus,
                        currentUser: user,
                        customerName: (selectedCustomer && (selectedCustomer.name || selectedCustomer.email)) || null,
                        periodMonth,
                        periodYear,
                        fromReviewUploadIds: selectedReviewUploadIds || (uid ? [uid] : []),
                        analyticsUploadIds: (reviewUploadOptions || []).map((o) => o.value),
                        date_range: reviewDateRange || undefined,
                      },
                    });
                  }}
                >
                  View analytics
                </button>
              </div>
            </div>

            <TransactionReview
              transactions={transactions}
              columnMapping={columnMapping}
              columnNames={columnNames}
              onApproval={handleApproval}
              onSubmitForApproval={handleSubmitForApproval}
              onCancel={handleReset}
              onCategoriesUpdated={refetchReviewTransactions}
              onViewAnalytics={({ uploadId: uid, transactions: txns, uploadStatus: status, currentUser: u }) => {
                navigate('/upload-analytics', {
                  state: {
                    uploadId: uid,
                    transactions: txns,
                    uploadStatus: status,
                    currentUser: u,
                    customerName: (selectedCustomer && (selectedCustomer.name || selectedCustomer.email)) || null,
                    periodMonth,
                    periodYear,
                    fromReviewUploadIds: selectedReviewUploadIds || [uid],
                    // All upload IDs for the period — analytics should show data for all records, not just the filtered selection
                    analyticsUploadIds: (reviewUploadOptions || []).map((o) => o.value),
                    date_range: reviewDateRange || undefined,
                  },
                });
              }}
              loading={loading || reviewLoading}
              currentUser={user}
              uploadStatus={uploadStatus}
              uploadId={selectedReviewUploadIds && selectedReviewUploadIds.length > 0 ? selectedReviewUploadIds[0] : null}
              preloadedCategories={location.state?.categories}
              selectedCustomer={selectedCustomer}
              periodMonth={periodMonth}
              periodYear={periodYear}
            />
          </div>
          );
        })()}
      </div>
    </div>
  );
};

export default Transactions;

