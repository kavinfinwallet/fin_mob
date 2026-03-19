import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import Select from '../components/Select';
import RequireCustomerGate from '../components/RequireCustomerGate';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCustomer } from '../context/CustomerContext';
import { formatCurrency as formatCurrencyUtil, getCurrencySymbol, getCurrencyCode } from '../constants/currencies';
import { Editor } from 'primereact/editor';
import { Dialog } from 'primereact/dialog';
import './Analytics.css';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title as ChartTitle,
  Tooltip,
  Legend,
} from 'chart.js';

const barValueLabelPlugin = {
  id: 'barValueLabel',
  afterDatasetsDraw(chart, args, pluginOptions) {
    const { ctx, data, chartArea } = chart;
    const dataset = data.datasets?.[0];
    const meta = chart.getDatasetMeta(0);
    if (!dataset || !meta || !meta.data) return;

    const opts = pluginOptions || {};

    ctx.save();
    meta.data.forEach((element, index) => {
      const rawValue = dataset.data[index];
      if (rawValue == null) return;

      const { x, y } = element.tooltipPosition();
      const label =
        typeof opts.formatter === 'function'
          ? opts.formatter(rawValue, index)
          : String(rawValue);

      // Top/inside label (compact value)
      const isNearTop = y < chartArea.top + 18;
      const textY = isNearTop ? y + 14 : y - 4;

      ctx.fillStyle = isNearTop ? '#ffffff' : opts.color || '#0f172a';
      ctx.font =
        opts.font ||
        '600 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, x, textY);

      // Bottom label: category name + exact value (stacked) under the axis
      if (typeof opts.bottomFormatter === 'function') {
        const categoryLabel = data.labels?.[index] ?? '';
        const valueLabel = opts.bottomFormatter(rawValue, index);
        const baseY = chartArea.bottom + (opts.bottomOffset ?? 10);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        // Category name (first line)
        ctx.fillStyle = opts.bottomLabelColor || '#4b5563';
        ctx.font =
          opts.bottomLabelFont ||
          '500 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText(categoryLabel, x, baseY);

        // Exact value (second line)
        ctx.fillStyle = opts.bottomColor || '#111827';
        ctx.font =
          opts.bottomFont ||
          '600 10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText(valueLabel, x, baseY + 12);
      }
    });
    ctx.restore();
  },
};

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ChartTitle,
  Tooltip,
  Legend,
  barValueLabelPlugin
);

const apiBase = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const fastApiUrl = (process.env.REACT_APP_FASTAPI_URL || 'http://localhost:8000').replace(/\/$/, '');

function extractCalendarDate(dateVal) {
  if (dateVal == null) return null;
  if (typeof dateVal === 'string') {
    const s = dateVal.trim();
    const datePart = s.split('T')[0] || s.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
    return null;
  }
  if (typeof dateVal === 'object' && dateVal.toISOString) {
    return dateVal.toISOString().split('T')[0];
  }
  return null;
}

function getTransactionDateBounds(txns) {
  if (!txns || txns.length === 0) return { min: '', max: '' };
  const dateStrings = txns
    .map((t) => extractCalendarDate(t.date))
    .filter(Boolean);
  if (dateStrings.length === 0) return { min: '', max: '' };
  dateStrings.sort();
  return {
    min: dateStrings[0],
    max: dateStrings[dateStrings.length - 1],
  };
}

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]*>/g, '').trim();
}

// Normalize for analytics (expects category_name)
function normalizeForAnalytics(txn) {
  const categoryName = txn.categoryName ?? txn.category_name ?? '';
  return {
    ...txn,
    category_name:
      typeof categoryName === 'string' && categoryName.trim()
        ? categoryName.trim()
        : 'Uncategorized',
  };
}

const UploadAnalytics = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { toast } = useToast();
  const { selectedCustomer, selectedCustomerId } = useCustomer();
  const analyticsRef = useRef(null);

  const initialState = location.state || {};
  const [transactions, setTransactions] = useState(
    (initialState.transactions || []).map(normalizeForAnalytics)
  );
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('all'); // all, month, year
  const initialBounds = initialState.date_range
    ? { min: initialState.date_range.min_date || '', max: initialState.date_range.max_date || '' }
    : getTransactionDateBounds(initialState.transactions || []);
  const [dateFrom, setDateFrom] = useState(initialBounds.min);
  const [dateTo, setDateTo] = useState(initialBounds.max);
  const [selectedCategoryGroup, setSelectedCategoryGroup] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedType, setSelectedType] = useState('all'); // all, credit, debit
  const [actionLoading, setActionLoading] = useState(false);
  const [categoryGroups, setCategoryGroups] = useState([]);
  const [availableCategories, setAvailableCategories] = useState([]);
  const [keyObservation, setKeyObservation] = useState(initialState.keyObservation ?? '');
  const [keyObservationAt, setKeyObservationAt] = useState(null);
  const [keyObservationByName, setKeyObservationByName] = useState(null);
  const [rmObservation, setRmObservation] = useState('');
  const [rmObservationAt, setRmObservationAt] = useState(null);
  const [rmObservationByName, setRmObservationByName] = useState(null);
  const [editingRmObs, setEditingRmObs] = useState(false);
  const [rmObsInput, setRmObsInput] = useState('');
  const [savingRmObs, setSavingRmObs] = useState(false);
  const [editingKeyObs, setEditingKeyObs] = useState(false);
  const [keyObsInput, setKeyObsInput] = useState('');
  const [savingKeyObs, setSavingKeyObs] = useState(false);
  const [rejectionComment, setRejectionComment] = useState(initialState.rejectionComment ?? '');
  const [uploadStatusFromServer, setUploadStatusFromServer] = useState(initialState.uploadStatus ?? null);
  const [rejectDialogVisible, setRejectDialogVisible] = useState(false);
  const [rejectCommentInput, setRejectCommentInput] = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [approvalHistory, setApprovalHistory] = useState([]);
  const [periodMonth, setPeriodMonth] = useState(initialState.periodMonth ?? null);
  const [periodYear, setPeriodYear] = useState(initialState.periodYear ?? null);
  const [declaredIncome, setDeclaredIncome] = useState(
    initialState.declaredIncome != null ? String(initialState.declaredIncome) : ''
  );
  const [goalAmount, setGoalAmount] = useState(
    initialState.goalAmount != null ? String(initialState.goalAmount) : ''
  );
  const [editingIncome, setEditingIncome] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const [incomeInput, setIncomeInput] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [savingIncome, setSavingIncome] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);
  const [uploaderName, setUploaderName] = useState(null);

  const uploadId = initialState.uploadId;
  const uploadStatus = initialState.uploadStatus || '';
  const currentUser = initialState.currentUser || authUser || null;
  const customerName =
    (selectedCustomer && (selectedCustomer.name || selectedCustomer.email)) ||
    initialState.customerName ||
    null;

  // When opened from review with analyticsUploadIds, load ALL records for analytics (ignore upload filter)
  const analyticsUploadIds = location.state?.analyticsUploadIds;
  useEffect(() => {
    if (!Array.isArray(analyticsUploadIds) || analyticsUploadIds.length === 0) return;
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const ids = analyticsUploadIds.join(',');
        const res = await axios.get(
          `${apiBase}/transactions/uploads/transactions?upload_ids=${ids}&status=all`
        );
        if (cancelled) return;
        const raw = (res.data.transactions || []).map((t) => ({
          ...t,
          category_name: t.category_name || t.categoryName || 'Uncategorized',
          category_id: t.category_id ?? t.categoryId,
        }));
        const list = raw
          .slice()
          .sort((a, b) => {
            const dA = a.date ? new Date(a.date).getTime() : 0;
            const dB = b.date ? new Date(b.date).getTime() : 0;
            return dA - dB || (a.id ?? 0) - (b.id ?? 0);
          });
        setTransactions(list.map(normalizeForAnalytics));
      } catch (err) {
        if (!cancelled) console.error('Error loading all transactions for analytics:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [analyticsUploadIds?.join(',')]);

  // Load all transactions for this month (customer + period_month + period_year) so analytics shows month-based records
  useEffect(() => {
    if (!uploadId || periodMonth == null || periodYear == null) return;
    const cid = selectedCustomerId === null || selectedCustomerId === undefined ? '' : String(selectedCustomerId);
    if (!cid || Number.isNaN(parseInt(cid, 10))) return;
    if (Array.isArray(analyticsUploadIds) && analyticsUploadIds.length > 0) return;
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        params.set('customer_id', cid);
        params.set('tab', 'all');
        params.set('page', '1');
        params.set('limit', '50');
        params.set('period_month', String(periodMonth));
        params.set('period_year', String(periodYear));
        const uploadsRes = await axios.get(`${apiBase}/transactions/uploads?${params.toString()}`);
        if (cancelled) return;
        const uploads = uploadsRes.data.uploads || [];
        const ids = uploads.map((u) => u.id).filter(Boolean);
        if (ids.length === 0) {
          setLoading(false);
          return;
        }
        const idsStr = ids.join(',');
        const txRes = await axios.get(
          `${apiBase}/transactions/uploads/transactions?upload_ids=${idsStr}&status=all`
        );
        if (cancelled) return;
        const raw = (txRes.data.transactions || []).map((t) => ({
          ...t,
          category_name: t.category_name || t.categoryName || 'Uncategorized',
          category_id: t.category_id ?? t.categoryId,
        }));
        const list = raw
          .slice()
          .sort((a, b) => {
            const dA = a.date ? new Date(a.date).getTime() : 0;
            const dB = b.date ? new Date(b.date).getTime() : 0;
            return dA - dB || (a.id ?? 0) - (b.id ?? 0);
          });
        setTransactions(list.map(normalizeForAnalytics));
      } catch (err) {
        if (!cancelled) console.error('Error loading month transactions for analytics:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [uploadId, periodMonth, periodYear, selectedCustomerId, analyticsUploadIds?.length]);

  // Sync transactions from location.state when returning from review (skip when analytics use all records)
  useEffect(() => {
    if (Array.isArray(analyticsUploadIds) && analyticsUploadIds.length > 0) return;
    const stateTxns = location.state?.transactions;
    if (Array.isArray(stateTxns) && stateTxns.length > 0) {
      setTransactions(stateTxns.map(normalizeForAnalytics));
    }
  }, [location.state?.transactions, analyticsUploadIds]);

  // Exact start/end of transactions — single source for date range display and default filter
  const transactionDateBounds = useMemo(
    () => getTransactionDateBounds(transactions),
    [transactions]
  );

  // Keep filter dates in sync with actual transaction bounds whenever transactions change
  useEffect(() => {
    if (transactions.length === 0) return;
    if (transactionDateBounds.min) setDateFrom(transactionDateBounds.min);
    if (transactionDateBounds.max) setDateTo(transactionDateBounds.max);
  }, [transactions, transactionDateBounds.min, transactionDateBounds.max]);

  useEffect(() => {
    if (!uploadId) {
      navigate('/transactions', { replace: true });
      return;
    }
    if (!Array.isArray(initialState.transactions)) {
      navigate('/transactions', { replace: true });
      return;
    }
    // When analytics use all records (from review), loading is cleared by the fetch effect
    if (Array.isArray(analyticsUploadIds) && analyticsUploadIds.length > 0) return;
    // When we have transactions in state, stop showing loader once sync has run (transactions are set from state)
    if (initialState.transactions.length > 0) {
      setLoading(false);
    }
  }, [uploadId, initialState.transactions, navigate, analyticsUploadIds]);

  // Admin/TL: load transactions by uploadId when opened from Approvals (no transactions in state)
  useEffect(() => {
    if (!uploadId || transactions.length > 0) return;
    const isAdmin =
      currentUser &&
      (currentUser.role === 'SUPER_ADMIN' ||
        currentUser.role === 'ADMIN' ||
        currentUser.role === 'TEAM_LEAD' ||
        currentUser.is_super_admin);
    if (!isAdmin) {
      navigate('/transactions', { replace: true });
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await axios.get(`${apiBase}/transactions/approval-detail/${uploadId}`);
        if (cancelled) return;
        const list = (res.data.transactions || []).map((t) => ({
          ...t,
          category_name: t.categoryName || t.category_name || 'Uncategorized',
          category_id: t.categoryId,
        }));
        setTransactions(list.map(normalizeForAnalytics));
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error('Error loading approval detail:', err);
          setLoading(false);
          navigate('/approvals', { replace: true });
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [uploadId, transactions.length, currentUser, navigate]);

  useEffect(() => {
    const load = async () => {
      try {
        const [groupsRes, categoriesRes] = await Promise.all([
          axios.get(`${apiBase}/categories/groups`),
          axios.get(`${apiBase}/categories`),
        ]);
        setCategoryGroups(groupsRes.data.groups || []);
        setAvailableCategories(categoriesRes.data.categories || []);
      } catch (err) {
        console.error('Error loading category groups/categories:', err);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!uploadId) return;
    const load = async () => {
      try {
        const [summaryRes, historyRes] = await Promise.all([
          axios.get(`${apiBase}/transactions/uploads/${uploadId}/executive-summary`),
          axios.get(`${apiBase}/transactions/uploads/${uploadId}/approval-history`),
        ]);
        const data = summaryRes.data;
        setKeyObservation(data.keyObservation || '');
        setKeyObservationAt(data.keyObservationAt || null);
        setKeyObservationByName(data.keyObservationByName || null);
        setRmObservation(data.rmObservation || '');
        setRmObservationAt(data.rmObservationAt || null);
        setRmObservationByName(data.rmObservationByName || null);
        setRejectionComment(data.rejectionComment || '');
        setUploadStatusFromServer(data.status || null);
        if (data.periodMonth != null) setPeriodMonth(data.periodMonth);
        if (data.periodYear != null) setPeriodYear(data.periodYear);
        if (data.declaredIncome != null) setDeclaredIncome(String(data.declaredIncome));
        if (data.goalAmount != null) setGoalAmount(String(data.goalAmount));
        if (data.uploaderName) setUploaderName(data.uploaderName);
        setApprovalHistory(historyRes.data.history || []);
      } catch (err) {
        console.error('Error loading executive summary or history:', err);
      }
    };
    load();
  }, [uploadId]);

  const getCategoryGroup = useCallback((categoryName) => {
    if (!categoryName) return 'Others';
    const cat = (availableCategories || []).find(
      (c) => String(c.name).trim().toLowerCase() === String(categoryName).trim().toLowerCase()
    );
    return (cat && cat.group_name) ? cat.group_name : 'Others';
  }, [availableCategories]);

  // Category tag from master (investment | emi | null) for EMI/Investment ratio
  const getCategoryTag = useCallback((categoryName) => {
    if (!categoryName) return null;
    const cat = (availableCategories || []).find(
      (c) => String(c.name).trim().toLowerCase() === String(categoryName).trim().toLowerCase()
    );
    const tag = cat && cat.category_tag ? String(cat.category_tag).toLowerCase() : null;
    return tag === 'emi' || tag === 'investment' ? tag : null;
  }, [availableCategories]);

  // Filter transactions: date range, date from/to, category group, category, type
  const filteredTransactions = useMemo(() => {
    let filtered = transactions;

    if (dateRange === 'month') {
      const now = new Date();
      const firstDayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      filtered = filtered.filter((txn) => {
        if (!txn.date) return false;
        return new Date(txn.date).toISOString().split('T')[0] >= firstDayStr;
      });
    } else if (dateRange === 'year') {
      const now = new Date();
      const firstDayStr = `${now.getFullYear()}-01-01`;
      filtered = filtered.filter((txn) => {
        if (!txn.date) return false;
        return new Date(txn.date).toISOString().split('T')[0] >= firstDayStr;
      });
    }

    if (dateFrom) {
      filtered = filtered.filter((txn) => {
        if (!txn.date) return false;
        const txnDate = new Date(txn.date).toISOString().split('T')[0];
        return txnDate >= dateFrom;
      });
    }
    if (dateTo) {
      filtered = filtered.filter((txn) => {
        if (!txn.date) return false;
        const txnDate = new Date(txn.date).toISOString().split('T')[0];
        return txnDate <= dateTo;
      });
    }

    if (selectedCategoryGroup !== 'all') {
      filtered = filtered.filter(
        (txn) => getCategoryGroup(txn.category_name) === selectedCategoryGroup
      );
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(
        (txn) => txn.category_name === selectedCategory
      );
    }

    if (selectedType !== 'all') {
      filtered = filtered.filter(
        (txn) => (txn.type || '').toLowerCase() === selectedType
      );
    }

    return filtered;
  }, [
    transactions,
    dateRange,
    dateFrom,
    dateTo,
    selectedCategoryGroup,
    selectedCategory,
    selectedType,
    getCategoryGroup,
  ]);

  const effectiveDeclaredIncome = useMemo(() => {
    const n = parseFloat(declaredIncome);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n;
  }, [declaredIncome]);

  // All debit transactions count as expense; credit as income (case-insensitive)
  const isDebit = (t) => (t.type || '').toString().toLowerCase() === 'debit';
  const isCredit = (t) => (t.type || '').toString().toLowerCase() === 'credit';

  // --- Base stats: always from ALL transactions (unaffected by filters) ---
  // Used for executive summary cards and all key ratios.
  const stats = useMemo(() => {
    const credits = transactions.filter(isCredit);
    const debits = transactions.filter(isDebit);

    const totalIncome = credits.reduce(
      (sum, t) => sum + parseFloat(t.amount || 0),
      0
    );
    const totalExpenses = debits.reduce(
      (sum, t) => sum + parseFloat(t.amount || 0),
      0
    );
    const balance = totalIncome - totalExpenses;
    const transactionCount = transactions.length;

    return {
      totalIncome,
      totalExpenses,
      balance,
      transactionCount,
      credits: credits.length,
      debits: debits.length,
    };
  }, [transactions]);

  const effectiveIncome = useMemo(() => {
    if (effectiveDeclaredIncome > 0) return effectiveDeclaredIncome;
    return stats.totalIncome || 0;
  }, [effectiveDeclaredIncome, stats.totalIncome]);

  const effectiveBalance = useMemo(() => {
    return effectiveIncome - stats.totalExpenses;
  }, [effectiveIncome, stats.totalExpenses]);

  // Category breakdown — uses filteredTransactions so chart responds to filters
  const categoryBreakdown = useMemo(() => {
    const breakdown = {};

    filteredTransactions.forEach((txn) => {
      if (!isDebit(txn)) return;
      const category = txn.category_name || 'Uncategorized';
      if (!breakdown[category]) {
          breakdown[category] = { amount: 0, count: 0 };
      }
      breakdown[category].amount += parseFloat(txn.amount || 0);
      breakdown[category].count += 1;
    });

    return Object.entries(breakdown)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredTransactions]);

  // Key ratios: always computed from ALL transactions so category/type filters don't distort them
  const ratioStats = useMemo(() => {
    const income = effectiveIncome || 0;
    const safeIncome = income > 0 ? income : 1;

    let emiAmount = 0;
    let investmentAmount = 0;

    transactions.forEach((txn) => {
      if (!isDebit(txn)) return;
      const amount = parseFloat(txn.amount || 0);
      const tag = getCategoryTag(txn.category_name);

      if (tag === 'emi') emiAmount += amount;
      else if (tag === 'investment') investmentAmount += amount;
    });

    const otherExpensesAmount = stats.totalExpenses - emiAmount - investmentAmount;

    // Expense % excludes EMI & Investment categories
    const expensePct = income > 0 ? (otherExpensesAmount / safeIncome) * 100 : 0;
    // Savings = income − total expense (all debits), can be negative
    const savingsPct = income > 0 ? (effectiveBalance / safeIncome) * 100 : 0;
    const emiPct = income > 0 ? (emiAmount / safeIncome) * 100 : 0;
    const investmentPct = income > 0 ? (investmentAmount / safeIncome) * 100 : 0;
    const otherExpensePct = expensePct;

    const clampPositive = (value) =>
      Number.isFinite(value) ? Math.max(0, Math.min(value, 999)) : 0;

    return {
      expensePct: clampPositive(expensePct),
      savingsPct: clampPositive(savingsPct),
      emiPct: clampPositive(emiPct),
      investmentPct: clampPositive(investmentPct),
      otherExpensePct: clampPositive(otherExpensePct),
      emiAmount,
      investmentAmount,
      otherExpensesAmount,
    };
  }, [transactions, effectiveIncome, effectiveBalance, stats.totalExpenses, getCategoryTag]);

  // Unique category names from full transaction set (for filter dropdown)
  const categoryOptions = useMemo(() => {
    const cats = new Set();
    transactions.forEach((txn) => {
      const name = txn.category_name || 'Uncategorized';
      if (name) cats.add(name);
    });
    return Array.from(cats).sort();
  }, [transactions]);

  // Categories in selected group (for dropdown when group is selected)
  const categoriesInGroup = useMemo(() => {
    if (selectedCategoryGroup === 'all') return categoryOptions;
    return categoryOptions.filter(
      (name) => getCategoryGroup(name) === selectedCategoryGroup
    );
  }, [categoryOptions, selectedCategoryGroup, getCategoryGroup]);

  const formatCurrency = (amount) => formatCurrencyUtil(amount, selectedCustomer);

  const handleSaveIncome = async () => {
    if (!uploadId) return;
    const currentStatus = uploadStatusFromServer ?? uploadStatus;
    if (currentStatus === 'completed') return;
    if (currentStatus === 'submitted' && !isAdmin) return;
    setSavingIncome(true);
    try {
      const res = await axios.patch(
        `${apiBase}/transactions/uploads/${uploadId}/income`,
        { declaredIncome: incomeInput === '' ? null : incomeInput }
      );
      setDeclaredIncome(
        res.data.declaredIncome != null ? String(res.data.declaredIncome) : incomeInput
      );
      setEditingIncome(false);
      toast('Income updated', 'success');
    } catch (err) {
      console.error('Error updating income:', err);
      toast(err.response?.data?.message || 'Failed to update income', 'error');
    } finally {
      setSavingIncome(false);
    }
  };

  const handleSaveGoal = async () => {
    if (!uploadId) return;
    const currentStatus = uploadStatusFromServer ?? uploadStatus;
    if (currentStatus === 'completed') return;
    if (currentStatus === 'submitted' && !isAdmin) return;
    setSavingGoal(true);
    try {
      const res = await axios.patch(
        `${apiBase}/transactions/uploads/${uploadId}/goal`,
        { goalAmount: goalInput === '' ? null : goalInput }
      );
      setGoalAmount(
        res.data.goalAmount != null ? String(res.data.goalAmount) : goalInput
      );
      setEditingGoal(false);
      toast('Monthly goal updated', 'success');
    } catch (err) {
      console.error('Error updating goal:', err);
      toast(err.response?.data?.message || 'Failed to update goal', 'error');
    } finally {
      setSavingGoal(false);
    }
  };

  const handleSaveRmObservation = async () => {
    if (!uploadId) return;
    if (status === 'submitted' && !isAdmin) return;
    setSavingRmObs(true);
    try {
      const res = await axios.patch(
        `${apiBase}/transactions/uploads/${uploadId}/rm-observation`,
        { rmObservation: rmObsInput }
      );
      setRmObservation(res.data.rmObservation || rmObsInput);
      setRmObservationAt(res.data.rmObservationAt || new Date().toISOString());
      setRmObservationByName(res.data.rmObservationByName || null);
      setEditingRmObs(false);
      toast('Observation saved', 'success');
    } catch (err) {
      console.error('Error saving RM observation:', err);
      toast(err.response?.data?.message || 'Failed to save observation', 'error');
    } finally {
      setSavingRmObs(false);
    }
  };

  const handleSaveKeyObservation = async () => {
    if (!uploadId) return;
    if (status === 'completed') return;
    setSavingKeyObs(true);
    try {
      await axios.patch(
        `${apiBase}/transactions/uploads/${uploadId}/executive-summary`,
        { keyObservation: keyObsInput }
      );
      setKeyObservation(keyObsInput || '');
      setKeyObservationAt(new Date().toISOString());
      setKeyObservationByName(authUser?.name || authUser?.email || null);
      setEditingKeyObs(false);
      toast('Key observation saved', 'success');
    } catch (err) {
      console.error('Error saving key observation:', err);
      toast(err.response?.data?.message || 'Failed to save key observation', 'error');
    } finally {
      setSavingKeyObs(false);
    }
  };

  const formatCompactCurrency = (amount) => formatCurrencyUtil(amount, selectedCustomer, { compact: true });

  // Chart.js data for category group-level spend (bar)
  const categoryGroupChartData = useMemo(() => {
    const groupTotals = {};

    filteredTransactions.forEach((txn) => {
      if (!isDebit(txn)) return;
      const groupName = getCategoryGroup(txn.category_name);
      const key = groupName || 'Others';
      const amount = parseFloat(txn.amount || 0);
      if (!groupTotals[key]) {
        groupTotals[key] = 0;
      }
      groupTotals[key] += amount;
    });

    // Sort by amount descending (highest first)
    const sorted = Object.entries(groupTotals).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(([label]) => label);
    const data = sorted.map(([, amount]) => amount);
    const colors = labels.map(
      (_, index) => `hsl(${(index * 36) % 360}, 70%, 55%)`
    );

    return {
      labels,
      datasets: labels.length
        ? [
            {
              label: 'Expenses',
              data,
              backgroundColor: colors,
              borderRadius: 8,
              barThickness: 48,
              maxBarThickness: 56,
            },
          ]
        : [],
    };
  }, [filteredTransactions, getCategoryGroup]);

  // Simple breakdown for category group-level spend to send to PDF (name + amount)
  const categoryGroupBreakdown = useMemo(() => {
    const groupTotals = {};

    filteredTransactions.forEach((txn) => {
      if (!isDebit(txn)) return;
      const groupName = getCategoryGroup(txn.category_name);
      const key = groupName || 'Others';
      const amount = parseFloat(txn.amount || 0);
      if (!groupTotals[key]) {
        groupTotals[key] = 0;
      }
      groupTotals[key] += amount;
    });

    return Object.entries(groupTotals)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredTransactions, getCategoryGroup]);

  const totalCategoryAmount = useMemo(() => {
    if (categoryBreakdown.length === 0) return 0;
    return categoryBreakdown.reduce((sum, c) => sum + c.amount, 0);
  }, [categoryBreakdown]);

  const barChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        bottom: 36,
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.parsed.y ?? context.parsed;
            return ` ${formatCurrency(value || 0)}`;
          },
        },
      },
      barValueLabel: {
        formatter: (value) => formatCompactCurrency(value || 0),
        bottomFormatter: (value) => formatCurrency(value || 0),
        bottomOffset: 16,
      },
    },
    animation: {
      duration: 800,
      easing: 'easeOutQuart',
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          display: false,
        },
        barPercentage: 0.5,
        categoryPercentage: 0.6,
      },
      y: {
        grid: { color: '#eef1f5' },
        ticks: {
          callback: (value) =>
            new Intl.NumberFormat('en-IN', {
              maximumFractionDigits: 0,
            }).format(value),
        },
      },
    },
  };

  const formatDate = (dateString) => {
    if (dateString == null || dateString === '') return '—';
    try {
      const date = new Date(dateString);
      if (Number.isNaN(date.getTime())) return String(dateString);
      return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return String(dateString);
    }
  };

  const handleDownloadPdf = async () => {
    try {
      const approvedEntry = approvalHistory.find((h) => h.action === 'approved' || h.action === 'APPROVED') || approvalHistory[approvalHistory.length - 1];
      const approvedBy = approvedEntry
        ? (approvedEntry.by_user_name || approvedEntry.by_user_email || '')
        : (currentUser && (currentUser.name || currentUser.email)) || '';
      const generatedBy = (currentUser && (currentUser.name || currentUser.email)) || '';

      const payload = {
        project_name: process.env.REACT_APP_NAME || 'Finwallet',
        statement_period: periodMonth != null && periodYear != null ? { month: periodMonth, year: periodYear } : {},
        date_from: dateFrom || null,
        date_to: dateTo || null,
        // Income: user-declared value; falls back to sum of credit transactions
        declared_income: effectiveDeclaredIncome || 0,
        total_income: effectiveIncome,
        monthly_goal: parseFloat(goalAmount) || 0,
        // Expense: all debit transactions
        total_expenses: stats.totalExpenses,
        expense_txn_count: stats.debits,
        // Savings: income − total expenses (clamped at 0)
        savings_amount: Math.max(0, effectiveBalance),
        net_surplus_deficit: effectiveBalance,
        income_txn_count: stats.credits,
        ratio_stats: {
          // Expense % excludes EMI & Investment categories
          expense_pct: ratioStats.expensePct,
          expense_amount: ratioStats.otherExpensesAmount,
          // Savings % = (income − total expenses) / income, min 0
          savings_pct: ratioStats.savingsPct,
          savings_amount: Math.max(0, effectiveBalance),
          // EMI: categories tagged EMI
          emi_pct: ratioStats.emiPct,
          emi_amount: ratioStats.emiAmount,
          // Investment: categories tagged Investment
          investment_pct: ratioStats.investmentPct,
          investment_amount: ratioStats.investmentAmount,
        },
        category_breakdown: categoryBreakdown.map((c) => ({
          name: c.name,
          amount: c.amount,
          count: c.count,
        })),
        category_group_breakdown: categoryGroupBreakdown.map((g) => ({
          name: g.name,
          amount: g.amount,
        })),
        approved_by_name: approvedBy,
        prepared_by_name: uploaderName || (currentUser && (currentUser.name || currentUser.email)) || '',
        generated_by_name: generatedBy,
        customer_name: customerName || '',
        generated_datetime: new Date().toISOString(),
        key_observation: keyObservation || '',
        currency_code: getCurrencyCode(selectedCustomer) || 'INR',
        currency_symbol: getCurrencySymbol(selectedCustomer) || 'Rs.',
      };

      const res = await axios.post(`${fastApiUrl}/generate-statement-pdf`, payload, {
        responseType: 'blob',
        headers: { 'Content-Type': 'application/json' },
      });

      const contentType = (res.headers && res.headers['content-type']) || '';
      if (!contentType.includes('application/pdf')) {
        const errorText = await new Response(res.data).text();
        let message = 'Failed to generate PDF';
        try {
          const parsed = JSON.parse(errorText);
          message = parsed.detail || parsed.message || message;
        } catch {
          if (errorText) message = errorText;
        }
        throw new Error(message);
      }

      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const safeName = (customerName || 'Statement').replace(/[/\\:*?"<>|]/g, ' ').trim() || 'Statement';
      const monthName = periodMonth != null && periodYear != null
        ? new Date(periodYear, periodMonth - 1).toLocaleDateString('en-US', { month: 'long' })
        : '';
      const pdfFileName = monthName && periodYear
        ? `${safeName} - ${monthName} - ${periodYear}.pdf`
        : `finwallet-statement-${uploadId || 'snapshot'}.pdf`;
      link.download = pdfFileName;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generating PDF download:', err);
      toast(err.response?.data?.message || err.message || 'Failed to generate PDF', 'error');
    }
  };

  const handleSubmitForApproval = async () => {
    if (!uploadId) return;
    setActionLoading(true);
    try {
      await axios.post(`${apiBase}/transactions/submit`, {
        uploadId,
        transactions: transactions.map((t) => ({
          ...t,
          categoryName: t.category_name,
          categoryId: t.category_id,
        })),
      });
      navigate('/upload-history', { replace: true });
    } catch (err) {
      console.error('Submit for approval failed:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproval = async () => {
    if (!uploadId) return;
    if (!keyObservationFilled) {
      toast('Key observation is required to approve', 'error');
      return;
    }
    setActionLoading(true);
    try {
      await axios.post(`${apiBase}/transactions/save`, {
        uploadId,
        transactions: transactions.map((t) => ({
          ...t,
          categoryName: t.category_name,
          categoryId: t.category_id,
        })),
        keyObservation: keyObservation || undefined,
      });
      toast('Budget approved successfully', 'success');
      navigate('/approvals', { replace: true });
    } catch (err) {
      console.error('Approve & save failed:', err);
      toast(err.response?.data?.message || 'Approve & save failed', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectClick = () => setRejectDialogVisible(true);
  const handleRejectConfirm = async () => {
    const comment = (rejectCommentInput || '').trim();
    if (!comment) return;
    setRejectSubmitting(true);
    try {
      await axios.post(`${apiBase}/transactions/uploads/${uploadId}/reject`, {
        comment,
      });
      setRejectionComment(comment);
      setUploadStatusFromServer('rejected');
      setRejectDialogVisible(false);
      setRejectCommentInput('');
      const historyRes = await axios.get(`${apiBase}/transactions/uploads/${uploadId}/approval-history`);
      setApprovalHistory(historyRes.data.history || []);
    } catch (err) {
      console.error('Reject failed:', err);
    } finally {
      setRejectSubmitting(false);
    }
  };
  const handleRejectDialogHide = () => {
    if (!rejectSubmitting) {
      setRejectDialogVisible(false);
      setRejectCommentInput('');
    }
  };

  const handleBackToReview = () => {
    const fromReviewIds = location.state?.fromReviewUploadIds;
    const uploadIds = Array.isArray(fromReviewIds) && fromReviewIds.length > 0
      ? fromReviewIds
      : (uploadId ? [uploadId] : []);
    navigate('/transactions', {
      state: {
        resume: true,
        uploadId,
        transactions,
        currentStep: 'review',
        status: uploadStatus,
        periodMonth: location.state?.periodMonth ?? periodMonth,
        periodYear: location.state?.periodYear ?? periodYear,
        uploadIds,
        categories: availableCategories && availableCategories.length > 0 ? availableCategories : undefined,
      },
    });
  };

  const isAdmin =
    currentUser &&
    (currentUser.role === 'SUPER_ADMIN' ||
      currentUser.role === 'ADMIN' ||
      currentUser.role === 'TEAM_LEAD' ||
      currentUser.is_super_admin);
  const isRM = currentUser?.role === 'RELATIONSHIP_MANAGER';
  const canEditRmObservation = isRM; // Only RM can edit RM observation; TL cannot
  const status = uploadStatusFromServer ?? uploadStatus;
  const canSubmit =
    isRM && status !== 'completed' && (status === 'rejected' || status !== 'submitted');
  const canApprove = isAdmin && status === 'submitted';
  const keyObservationFilled = stripHtml(keyObservation).length > 0;
  const canApproveWithObservation = canApprove && keyObservationFilled;

  if (loading) {
    return (
      <div className="app">
        <Navbar />
        <RequireCustomerGate>
          <div className="analytics-container">
            <div className="loading-spinner">Loading analytics...</div>
          </div>
        </RequireCustomerGate>
      </div>
    );
  }

  return (
    <div className="app">
      <Navbar />
      <RequireCustomerGate>
        <div className="analytics-container" ref={analyticsRef}>
          <div className="analytics-header">
            <div className="analytics-header-main">
              <div className="analytics-header-title-area">
                <div className="analytics-title-row">
                  <h1>
                    {periodMonth && periodYear
                      ? `${new Date(periodYear, periodMonth - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} — Statement Analytics`
                      : 'Statement Analytics'}
                  </h1>
                  {status && (
                    <span className={`analytics-header-status-badge analytics-status-${status}`}>
                      {status === 'completed' && 'Approved'}
                      {status === 'rejected' && 'Rejected'}
                      {status === 'submitted' && 'Submitted for approval'}
                      {status !== 'completed' && status !== 'rejected' && status !== 'submitted' && status}
                    </span>
                  )}
                </div>
                {status === 'completed' && (
                  <div className="analytics-export-actions">
                    <button
                      type="button"
                      className="analytics-export-btn"
                      onClick={handleDownloadPdf}
                    >
                      Download PDF
                    </button>
                  </div>
                )}
              </div>
              <div className="analytics-review-actions analytics-review-actions-top">
                {isAdmin ? (
                  <>
                    <button
                      type="button"
                      className="analytics-btn secondary"
                      onClick={() => navigate('/approvals')}
                      disabled={actionLoading}
                    >
                      Back to approvals
                    </button>
                    {isAdmin && status !== 'completed' && (
                      <button
                        type="button"
                        className="analytics-btn secondary"
                        onClick={() =>
                          navigate('/transactions', {
                            state: {
                              reviewForMonth: true,
                              uploadIds: [uploadId],
                              periodMonth: periodMonth ?? undefined,
                              periodYear: periodYear ?? undefined,
                            },
                          })
                        }
                        disabled={actionLoading}
                      >
                        View transactions
                      </button>
                    )}
                    {canApprove && (
                      <>
                        <button
                          type="button"
                          className="analytics-btn secondary"
                          onClick={handleRejectClick}
                          disabled={actionLoading}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className="analytics-btn primary"
                          onClick={handleApproval}
                          disabled={actionLoading || !canApproveWithObservation}
                          title={!keyObservationFilled ? 'Fill Key observation to approve' : ''}
                        >
                          {actionLoading ? 'Saving...' : 'Approve & Save'}
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="analytics-btn secondary"
                      onClick={handleBackToReview}
                      disabled={actionLoading}
                    >
                      Back to review
                    </button>
                    {canSubmit && (
                      <button
                        type="button"
                        className="analytics-btn secondary"
                        onClick={handleSubmitForApproval}
                        disabled={actionLoading}
                      >
                        {actionLoading ? 'Submitting...' : 'Submit for Approval'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {!loading && transactions.length === 0 ? (
            <div className="analytics-empty-state">
              <div className="analytics-empty-state-icon">📊</div>
              <p className="analytics-empty-state-title">No transaction data</p>
              <p className="analytics-empty-state-desc">There are no transactions for this upload or period. Go back to review to upload or map transactions.</p>
              <button type="button" className="analytics-btn secondary" onClick={handleBackToReview}>
                Back to review
              </button>
            </div>
          ) : (
          <>
          {/* Filters + meta row */}
          <div className="analytics-filters upload-analytics-filters">
            {/* Left: Date range — exact start/end of loaded transactions */}
            <div className="filter-group filter-group-date-range">
              <label>Date range</label>
              <div className="date-range-display">
                <span className="date-range-value">
                  {transactionDateBounds.min
                    ? (() => {
                        const [y, m, d] = transactionDateBounds.min.split('-');
                        return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                      })()
                    : '—'}
                </span>
                <span className="date-range-sep">→</span>
                <span className="date-range-value">
                  {transactionDateBounds.max
                    ? (() => {
                        const [y, m, d] = transactionDateBounds.max.split('-');
                        return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                      })()
                    : '—'}
                </span>
              </div>
            </div>
            <div className="analytics-meta-divider" />
            <div className="filter-group analytics-meta-group">
              <label>Prepared by</label>
              <div className="analytics-meta-box">
                {uploaderName || (currentUser && (currentUser.name || currentUser.username)) || '—'}
              </div>
            </div>
            <div className="filter-group analytics-meta-group">
              <label>Approved by</label>
              <div className="analytics-meta-box">
                {(() => {
                  const entry = approvalHistory.find(
                    (h) => h.action === 'approved' || h.action === 'APPROVED'
                  );
                  return entry ? (entry.by_user_name || entry.by_user_email || '—') : '—';
                })()}
              </div>
            </div>

            {/* Right: Income & Goal inline edit */}
            <div className="analytics-meta-divider analytics-meta-divider--push-right" />
            <div className="filter-group analytics-meta-group">
              <label>Monthly Income</label>
              <div className="analytics-inline-edit-box">
                {editingIncome && status !== 'completed' && (status !== 'submitted' || isAdmin) ? (
                  <>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="analytics-inline-input"
                      value={incomeInput}
                      onChange={(e) => setIncomeInput(e.target.value)}
                      autoFocus
                    />
                    <button type="button" className="analytics-inline-btn save" onClick={handleSaveIncome} disabled={savingIncome}>
                      {savingIncome ? '…' : 'Save'}
                    </button>
                    <button type="button" className="analytics-inline-btn cancel" onClick={() => setEditingIncome(false)} disabled={savingIncome}>
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    <span className="analytics-inline-value">
                      {effectiveDeclaredIncome > 0 ? formatCurrency(effectiveDeclaredIncome) : formatCurrency(stats.totalIncome)}
                    </span>
                    {(isAdmin || isRM) && status !== 'completed' && (status !== 'submitted' || isAdmin) && (
                      <button type="button" className="analytics-inline-btn edit" onClick={() => { setIncomeInput(declaredIncome); setEditingIncome(true); }}>
                        ✏️
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="filter-group analytics-meta-group">
              <label>Monthly Goal</label>
              <div className="analytics-inline-edit-box">
                {editingGoal && status !== 'completed' && (status !== 'submitted' || isAdmin) ? (
                  <>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="analytics-inline-input"
                      value={goalInput}
                      onChange={(e) => setGoalInput(e.target.value)}
                      autoFocus
                    />
                    <button type="button" className="analytics-inline-btn save" onClick={handleSaveGoal} disabled={savingGoal}>
                      {savingGoal ? '…' : 'Save'}
                    </button>
                    <button type="button" className="analytics-inline-btn cancel" onClick={() => setEditingGoal(false)} disabled={savingGoal}>
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    <span className="analytics-inline-value">
                      {goalAmount && goalAmount !== '' ? formatCurrency(parseFloat(goalAmount || 0)) : formatCurrency(0)}
                    </span>
                    {(isAdmin || isRM) && status !== 'completed' && (status !== 'submitted' || isAdmin) && (
                      <button type="button" className="analytics-inline-btn edit" onClick={() => { setGoalInput(goalAmount); setEditingGoal(true); }}>
                        ✏️
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {rejectionComment && isRM && (
            <div className="executive-summary-rejection-banner">
              <strong>Budget rejected</strong>
              <p>{rejectionComment}</p>
              <span className="executive-summary-rejection-hint">
                Please address the feedback above, then click &quot;Submit for Approval&quot; to resubmit.
              </span>
            </div>
          )}

          {/* Observation History + Approval history — same row, below date area */}
          <div className="history-sections-row">
            <div className="obs-history-card obs-history-standalone">
              <div className="obs-history-header">
                <span className="obs-history-icon">🔍</span>
                <span className="obs-history-title">Observation History</span>
              </div>
              <div className="obs-history-timeline">
                    {(() => {
                      const timeRm = rmObservationAt ? new Date(rmObservationAt).getTime() : 0;
                      const timeKey = keyObservationAt ? new Date(keyObservationAt).getTime() : 0;
                      const rmOrder = timeRm >= timeKey ? 1 : 2;
                      const keyOrder = timeKey >= timeRm ? 1 : 2;
                      return (
                        <>
                    {/* RM Observation entry — order: latest first */}
                    <div className="obs-entry" style={{ order: rmOrder }}>
                      <div className="obs-entry-dot rm"></div>
                      <div className="obs-entry-body">
                        <div className="obs-entry-meta">
                          <span className="obs-entry-role rm-role">RM Observation</span>
                          {rmObservationByName && (
                            <span className="obs-entry-author">{rmObservationByName}</span>
                          )}
                          {rmObservationAt && (
                            <span className="obs-entry-time">
                              {new Date(rmObservationAt).toLocaleString('en-GB', {
                                day: '2-digit', month: 'short', year: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          )}
                          {canEditRmObservation && (status !== 'submitted' && status !== 'completed' || isAdmin) && !editingRmObs && (
                            <button
                              type="button"
                              className="obs-edit-btn"
                              onClick={() => { setRmObsInput(rmObservation); setEditingRmObs(true); }}
                            >
                              {rmObservation ? 'Edit' : '+ Add'}
                            </button>
                          )}
                        </div>
                        {editingRmObs ? (
                          <div className="obs-edit-form">
                            <Editor
                              value={rmObsInput}
                              onTextChange={(e) => setRmObsInput(e.htmlValue ?? '')}
                              style={{ height: '120px' }}
                              placeholder="Write your observation for this statement..."
                            />
                            <div className="obs-edit-actions">
                              <button
                                type="button"
                                className="card-edit-save-btn"
                                onClick={handleSaveRmObservation}
                                disabled={savingRmObs}
                              >
                                {savingRmObs ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                className="card-edit-cancel-btn"
                                onClick={() => setEditingRmObs(false)}
                                disabled={savingRmObs}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="obs-entry-content ql-editor"
                            dangerouslySetInnerHTML={{
                              __html: rmObservation || '<em class=\"obs-empty\">No observation added yet.</em>',
                            }}
                          />
                        )}
                      </div>
                    </div>

                    {/* Key Observation entry — order: latest first */}
                    <div className="obs-entry" style={{ order: keyOrder }}>
                      <div className="obs-entry-dot tl"></div>
                      <div className="obs-entry-body">
                        <div className="obs-entry-meta">
                          <span className="obs-entry-role tl-role">Key Observation</span>
                          {keyObservationByName && (
                            <span className="obs-entry-author">{keyObservationByName}</span>
                          )}
                          {keyObservationAt && (
                            <span className="obs-entry-time">
                              {new Date(keyObservationAt).toLocaleString('en-GB', {
                                day: '2-digit', month: 'short', year: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          )}
                          {isAdmin && status !== 'completed' && !editingKeyObs && (
                            <button
                              type="button"
                              className="obs-edit-btn"
                              onClick={() => { setKeyObsInput(keyObservation); setEditingKeyObs(true); }}
                            >
                              {keyObservation ? 'Edit' : '+ Add'}
                            </button>
                          )}
                        </div>
                        {editingKeyObs ? (
                          <div className="obs-edit-form">
                            <Editor
                              value={keyObsInput}
                              onTextChange={(e) => setKeyObsInput(e.htmlValue ?? '')}
                              style={{ height: '120px' }}
                              placeholder="Fill in the final key observation (required to approve)."
                            />
                            <div className="obs-edit-actions">
                              <button
                                type="button"
                                className="card-edit-save-btn"
                                onClick={handleSaveKeyObservation}
                                disabled={savingKeyObs}
                              >
                                {savingKeyObs ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                className="card-edit-cancel-btn"
                                onClick={() => setEditingKeyObs(false)}
                                disabled={savingKeyObs}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="obs-entry-content ql-editor"
                            dangerouslySetInnerHTML={{
                              __html: keyObservation || '<em class="obs-empty">No key observation added yet.</em>',
                            }}
                          />
                        )}
                      </div>
                    </div>

                        </>
                      );
                    })()}
              </div>{/* end obs-history-timeline */}
            </div>{/* end obs-history-standalone */}

            <div className="approval-history-card">
              <h2 className="approval-history-title">Approval history</h2>
              <p className="approval-history-subtitle">
                Every action on this upload until approval
              </p>
              {approvalHistory.length === 0 ? (
                <div className="approval-history-empty">
                  No actions yet. Submit for approval to start the history.
                </div>
              ) : (
                <ul className="approval-history-list">
                  {approvalHistory.map((entry) => (
                    <li key={entry.id} className={`approval-history-item approval-history-${entry.action}`}>
                      <span className="approval-history-action">
                        {entry.action === 'submitted' && 'Submitted for approval'}
                        {entry.action === 'resubmitted' && 'Resubmitted'}
                        {entry.action === 'rejected' && 'Rejected'}
                        {entry.action === 'approved' && 'Approved'}
                      </span>
                      <span className="approval-history-by">
                        by {entry.by_user_name || entry.by_user_email || 'Unknown'}
                        {entry.by_user_role && (
                          <span className="approval-history-role"> ({entry.by_user_role.replace(/_/g, ' ')})</span>
                        )}
                      </span>
                      <span className="approval-history-date">
                        {formatDate(entry.created_at)}
                        {entry.created_at && (() => {
                          const d = new Date(entry.created_at);
                          const t = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                          return t ? ` at ${t}` : '';
                        })()}
                      </span>
                      {entry.comment && (
                        <div className="approval-history-comment">&ldquo;{entry.comment}&rdquo;</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Executive Summary (1-page snapshot) */}
          <div className="executive-summary-card">
            <div className="executive-summary-body">

              {/* Group 1: Executive Summary */}
              <div className="executive-summary-group">
                <h3 className="executive-summary-group-heading">Executive Summary</h3>
                <div className="executive-summary-cards-grid">
                  <div className="executive-summary-block-card">
                    <div className="executive-summary-block-header">
                      <div className="executive-summary-block-icon income-icon">💰</div>
                      <div className="executive-summary-block-title">Total Income</div>
                    </div>
                    <div className="executive-summary-block-body executive-summary-metric-body">
                      <div className="executive-summary-metric-value">
                        {formatCurrency(effectiveIncome)}
                      </div>
                      <div className="executive-summary-metric-subtitle">
                        {stats.credits} income transaction{stats.credits !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  <div className="executive-summary-block-card">
                    <div className="executive-summary-block-header">
                      <div className="executive-summary-block-icon expense-icon">💸</div>
                      <div className="executive-summary-block-title">Total Expenses (Inc Expenses & Investments)</div>
                    </div>
                    <div className="executive-summary-block-body executive-summary-metric-body">
                      <div className="executive-summary-metric-value">
                        {formatCurrency(stats.totalExpenses)}
                      </div>
                      <div className="executive-summary-metric-subtitle">
                        {stats.debits} expense transaction{stats.debits !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  <div className="executive-summary-block-card">
                    <div className="executive-summary-block-header">
                      <div className="executive-summary-block-icon balance-icon">📈</div>
                      <div className="executive-summary-block-title">Net Surplus / Deficit</div>
                    </div>
                    <div className="executive-summary-block-body executive-summary-metric-body">
                      <div
                        className={`executive-summary-metric-value ${
                          effectiveBalance >= 0 ? 'surplus' : 'deficit'
                        }`}
                      >
                        {effectiveBalance >= 0 ? 'Surplus ' : 'Deficit '}
                        {formatCurrency(effectiveBalance)}
                      </div>
                      <div className="executive-summary-metric-subtitle">
                        Income - Expenses
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Group 2: Key Ratios & Indicators (EMI & Investment from category tag; rest = other/savings) */}
              <div className="executive-summary-group">
                <h3 className="executive-summary-group-heading">Key Ratios &amp; Indicators</h3>
                <div className="executive-summary-cards-grid">
                  <div className="executive-summary-block-card">
                    <div className="executive-summary-block-header">
                      <div className="executive-summary-block-icon ratios-icon">📊</div>
                      <div className="executive-summary-block-title">Expense (% of Income)</div>
                    </div>
                    <div className="executive-summary-block-body executive-summary-metric-body">
                      <div className="executive-summary-metric-value">
                        {ratioStats.expensePct.toFixed(1)}%
                      </div>
                      <div className="executive-summary-metric-subtitle">
                        Expenses excluding EMI &amp; Investments
                      </div>
                    </div>
                  </div>
                  <div className="executive-summary-block-card">
                    <div className="executive-summary-block-header">
                      <div className="executive-summary-block-icon savings-icon">💾</div>
                      <div className="executive-summary-block-title">Savings (% of Income)</div>
                    </div>
                    <div className="executive-summary-block-body executive-summary-metric-body">
                      <div className="executive-summary-metric-value">
                        {ratioStats.savingsPct.toFixed(1)}%
                      </div>
                      <div className="executive-summary-metric-subtitle">
                        Income − Total Expenses
                      </div>
                    </div>
                  </div>
                  <div className="executive-summary-block-card">
                    <div className="executive-summary-block-header">
                      <div className="executive-summary-block-icon emi-icon">🧾</div>
                      <div className="executive-summary-block-title">EMI (% of Income)</div>
                    </div>
                    <div className="executive-summary-block-body executive-summary-metric-body">
                      <div className="executive-summary-metric-value">
                        {ratioStats.emiPct.toFixed(1)}%
                      </div>
                      <div className="executive-summary-metric-subtitle">
                        Categories tagged EMI · {formatCurrency(ratioStats.emiAmount)}
                      </div>
                    </div>
                  </div>
                  <div className="executive-summary-block-card">
                    <div className="executive-summary-block-header">
                      <div className="executive-summary-block-icon investment-icon">📦</div>
                      <div className="executive-summary-block-title">Investment (% of Income)</div>
                    </div>
                    <div className="executive-summary-block-body executive-summary-metric-body">
                      <div className="executive-summary-metric-value">
                        {ratioStats.investmentPct.toFixed(1)}%
                      </div>
                      <div className="executive-summary-metric-subtitle">
                        Categories tagged Investment · {formatCurrency(ratioStats.investmentAmount)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Key Observation — below key ratio cards (content only; edit in Observation History) */}
              <div className="executive-summary-group">
                <h3 className="executive-summary-group-heading">Key Observation</h3>
                <div className="key-observation-section">
                  <div className="key-observation-box">
                    <div
                      className="key-observation-content ql-editor"
                      dangerouslySetInnerHTML={{
                        __html: keyObservation || '<em class="obs-empty">No key observation added yet.</em>',
                      }}
                    />
                    {canApprove && !keyObservationFilled && (
                      <p className="executive-summary-key-observation-required">
                        Key observation is required to approve.
                      </p>
                    )}
                    {keyObservationByName && (
                      <p className="key-observation-meta">
                        {keyObservationByName}
                        {keyObservationAt && (
                          <> · {new Date(keyObservationAt).toLocaleString('en-GB', {
                            day: '2-digit', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}</>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>

            </div>{/* end executive-summary-body */}
          </div>{/* end executive-summary-card */}

          <Dialog
            header="Reject budget"
            visible={rejectDialogVisible}
            onHide={handleRejectDialogHide}
            footer={
              <div className="executive-summary-reject-dialog-footer">
                <button
                  type="button"
                  className="analytics-btn secondary"
                  onClick={handleRejectDialogHide}
                  disabled={rejectSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="analytics-btn primary"
                  style={{ background: '#ef4444' }}
                  onClick={handleRejectConfirm}
                  disabled={rejectSubmitting || !rejectCommentInput.trim()}
                >
                  {rejectSubmitting ? 'Rejecting...' : 'Reject'}
                </button>
              </div>
            }
            className="executive-summary-reject-dialog"
            style={{ width: '90vw', maxWidth: '420px' }}
          >
            <div className="executive-summary-reject-dialog-content">
              <p className="executive-summary-reject-dialog-text">
                A comment is required when rejecting. It will be logged and shown to the Relationship Manager so they can fix and resubmit.
              </p>
              <label htmlFor="reject-comment" className="executive-summary-reject-label">
                Comment (required)
              </label>
              <textarea
                id="reject-comment"
                className="executive-summary-reject-textarea"
                value={rejectCommentInput}
                onChange={(e) => setRejectCommentInput(e.target.value)}
                placeholder="Reason for rejection..."
                rows={4}
              />
            </div>
          </Dialog>

          {/* Modern Charts */}
          <div className="charts-grid">
            <div className="chart-card full-width">
              <h2>Spending by Category Group</h2>
              <div className="chart-content" style={{ height: 280 }}>
                {categoryGroupChartData.labels.length ? (
                  <Bar data={categoryGroupChartData} options={barChartOptions} />
                ) : (
                  <div className="no-data">No category group data available</div>
                )}
              </div>
            </div>

            <div className="chart-card full-width">
              <h2>Spending by Category</h2>
              <div className="chart-content">
                {categoryBreakdown.length ? (
                  <div className="category-list">
                    {categoryBreakdown.map((category, index) => {
                      const percentage =
                        totalCategoryAmount > 0
                          ? (category.amount / totalCategoryAmount) * 100
                          : 0;
                      return (
                        <div key={category.name} className="category-item">
                          <div className="category-item-header">
                            <div
                              className="category-color"
                              style={{
                                backgroundColor: `hsl(${
                                  (index * 32) % 360
                                }, 70%, 55%)`,
                              }}
                            />
                            <span className="category-item-name">
                              {category.name}
                            </span>
                            <span className="category-item-percentage">
                              {percentage.toFixed(1)}%
                            </span>
                          </div>
                          <div className="category-item-bar">
                            <div
                              className="category-item-fill"
                              style={{
                                width: `${percentage}%`,
                                backgroundColor: `hsl(${
                                  (index * 32) % 360
                                }, 70%, 55%)`,
                              }}
                            />
                          </div>
                          <div className="category-item-footer">
                            <span>{formatCurrency(category.amount)}</span>
                            <span>
                              {category.count} transaction
                              {category.count !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="no-data">No category data available</div>
                )}
              </div>
            </div>
          </div>

          </>
          )}

        </div>
      </RequireCustomerGate>
    </div>
  );
};

export default UploadAnalytics;

