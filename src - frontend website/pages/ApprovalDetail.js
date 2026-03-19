import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCustomer } from '../context/CustomerContext';
import { formatCurrency as formatCurrencyUtil } from '../constants/currencies';
import RequireCustomerGate from '../components/RequireCustomerGate';
import './ApprovalDetail.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const ApprovalDetail = () => {
  const { uploadId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { selectedCustomer } = useCustomer();
  const [upload, setUpload] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'TEAM_LEAD' || user?.is_super_admin;

  useEffect(() => {
    if (!isAdmin || !uploadId) {
      setLoading(false);
      return;
    }
    const load = async () => {
      try {
        setLoading(true);
        const [detailRes, catRes] = await Promise.all([
          axios.get(`${API}/transactions/approval-detail/${uploadId}`),
          axios.get(`${API}/categories`)
        ]);
        setUpload({
          uploadId: detailRes.data.uploadId,
          customerName: detailRes.data.customerName,
          status: detailRes.data.status || null,
        });
        setTransactions(detailRes.data.transactions || []);
        setCategories(catRes.data.categories || []);
      } catch (err) {
        toast(err.response?.data?.message || 'Error loading approval', 'error');
        navigate('/approvals');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [uploadId, isAdmin, navigate, toast]);

  const isApproved = upload?.status === 'completed';
  const isSubmitted = upload?.status === 'submitted';
  // TL/Admin can edit categories when reviewing submitted items.
  const canEditCategories = !isApproved && (!isSubmitted || isAdmin);

  const categoryOptions = useMemo(() => {
    const uncategorized = { label: 'Uncategorized', value: 'Uncategorized', id: null, groupName: 'Others' };
    const fromApi = (categories || []).map((c) => ({
      label: c.name,
      value: c.name,
      id: c.id,
      groupName: (c.group_name || 'Others').trim(),
    }));
    return [uncategorized, ...fromApi];
  }, [categories]);

  const resolveCategoryIdByName = (name) => {
    const n = (name != null ? String(name).trim() : '') || 'Uncategorized';
    const cat = (categories || []).find(
      (c) => String(c.name || '').trim().toLowerCase() === n.toLowerCase()
    );
    return cat ? cat.id : null;
  };

  const handleCategoryChange = async (txnId, selectedOption) => {
    if (!canEditCategories) return;
    if (selectedOption == null) return;
    const opt = selectedOption;
    const displayName = (opt.label || opt.value || '').trim() || 'Uncategorized';
    let newCategoryId =
      opt.id != null && opt.id !== '' ? (typeof opt.id === 'number' ? opt.id : parseInt(opt.id, 10)) : null;
    if (!Number.isFinite(newCategoryId)) {
      newCategoryId = resolveCategoryIdByName(opt.value || displayName);
    }
    const validId = Number.isFinite(newCategoryId) ? newCategoryId : null;

    setTransactions((prev) =>
      prev.map((t) => (t.id === txnId ? { ...t, categoryName: displayName, categoryId: validId } : t))
    );

    try {
      await axios.patch(`${API}/transactions/${txnId}/category`, {
        categoryId: validId,
        categoryName: displayName,
      });
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to save category change', 'error');
      setTransactions((prev) =>
        prev.map((t) => (t.id === txnId ? { ...t, categoryName: t.categoryName, categoryId: t.categoryId } : t))
      );
    }
  };

  const formatAmount = (amount) => formatCurrencyUtil(amount, selectedCustomer);

  const openInUploadAnalytics = () => {
    navigate('/upload-analytics', {
      state: {
        uploadId: Number(uploadId),
        transactions: transactions.map(t => ({
          ...t,
          category_name: t.categoryName || t.category_name || 'Uncategorized',
          category_id: t.categoryId
        })),
        uploadStatus: 'submitted',
        currentUser: user
      }
    });
  };

  if (!isAdmin) {
    return (
      <div className="app">
        <Navbar />
        <div className="approval-detail-container">
          <p>You do not have permission to view this page.</p>
        </div>
      </div>
    );
  }

  if (loading || !upload) {
    return (
      <div className="app">
        <Navbar />
        <RequireCustomerGate>
          <div className="approval-detail-container">
            <div className="loading-spinner">{loading ? 'Loading...' : 'Not found.'}</div>
          </div>
        </RequireCustomerGate>
      </div>
    );
  }

  return (
    <div className="app">
      <Navbar />
      <RequireCustomerGate>
        <div className="approval-detail-container">
          <div className="approval-detail-card">
            <div className="approval-detail-header">
              <h1>Review transactions</h1>
              <p className="approval-customer">
                Customer: <strong>{upload.customerName || '—'}</strong>
              </p>
              <p className="approval-count">
                {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
                {isApproved
                  ? ' — This upload has been approved. Categories cannot be changed.'
                  : isSubmitted
                    ? ' — Submitted for approval. No edits allowed until approved or rejected.'
                    : ' — Change category if needed, then go back to Upload Analytics to add Key observation and approve.'}
              </p>
            </div>

            <div className="approval-table-wrap">
              <table className="approval-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Type</th>
                    <th>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn) => (
                    <tr key={txn.id}>
                      <td>{txn.date}</td>
                      <td>{txn.description}</td>
                      <td>{formatAmount(txn.amount)}</td>
                      <td>{txn.type ? String(txn.type).charAt(0).toUpperCase() + String(txn.type).slice(1) : '—'}</td>
                      <td>
                        {!canEditCategories ? (
                          <span className="approval-category-readonly">{txn.categoryName || 'Uncategorized'}</span>
                        ) : !(categories && categories.length > 0) ? (
                          <span className="approval-category-readonly">{txn.categoryName || 'Uncategorized'}</span>
                        ) : (
                          <Autocomplete
                            size="small"
                            disableClearable
                            value={
                              categoryOptions.find(
                                (o) =>
                                  String(o.value).trim().toLowerCase() ===
                                  String(txn.categoryName || 'Uncategorized').trim().toLowerCase()
                              ) || categoryOptions[0]
                            }
                            options={categoryOptions}
                            groupBy={(option) => option.groupName || 'Others'}
                            getOptionLabel={(opt) => opt?.label ?? ''}
                            isOptionEqualToValue={(a, b) => a.value === b.value}
                            onChange={(e, newValue) => handleCategoryChange(txn.id, newValue)}
                            renderInput={(params) => (
                              <TextField {...params} placeholder="Category" className="approval-category-select" />
                            )}
                            sx={{ minWidth: 160 }}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="approval-actions">
              <button type="button" className="btn-secondary" onClick={() => navigate('/approvals')}>
                Back to approvals
              </button>
              <button type="button" className="btn-primary" onClick={openInUploadAnalytics}>
                Back to Upload Analytics (approve from there)
              </button>
            </div>
          </div>
        </div>
      </RequireCustomerGate>
    </div>
  );
};

export default ApprovalDetail;
