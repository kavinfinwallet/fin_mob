import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import RequireCustomerGate from '../components/RequireCustomerGate';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useCustomer } from '../context/CustomerContext';
import { formatCurrency } from '../constants/currencies';
import './UploadHistory.css';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'wait_for_approval', label: 'Wait for approval' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

const apiBase = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const PAGE_SIZE = 100; // fetch more to group by month

const UploadHistory = () => {
  const [groupedByMonth, setGroupedByMonth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [categoryChangesForId, setCategoryChangesForId] = useState(null);
  const [categoryChangesList, setCategoryChangesList] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { uploadId, fileName }
  const [deleting, setDeleting] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState(new Set());
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { selectedCustomerId, selectedCustomer } = useCustomer();

  const loadUploadHistory = useCallback(async (tab, customerId, pageNum, search, signal) => {
    if (customerId == null || customerId === '') {
      setGroupedByMonth([]);
      setTotal(0);
      setTotalPages(0);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('customer_id', String(customerId));
      params.set('tab', tab || 'all');
      params.set('page', String(pageNum));
      params.set('limit', String(PAGE_SIZE));
      params.set('group_by_month', 'true');
      if (search && search.trim()) params.set('search', search.trim());
      const response = await axios.get(`${apiBase}/transactions/uploads?${params.toString()}`, { signal });
      if (signal?.aborted) return;
      setTotal(response.data.total ?? 0);
      setTotalPages(response.data.total_pages ?? 1);
      setGroupedByMonth(response.data.grouped_by_month ?? []);
    } catch (err) {
      if (axios.isCancel(err) || (err.name === 'AbortError')) return;
      if (err.response?.status === 400 && err.response?.data?.message?.toLowerCase().includes('customer_id')) {
        setGroupedByMonth([]);
        setTotal(0);
        setTotalPages(0);
      } else {
        toast(err.response?.data?.message || 'Error loading budget history', 'error');
        setGroupedByMonth([]);
        setTotal(0);
        setTotalPages(0);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const controller = new AbortController();
    loadUploadHistory(activeTab, selectedCustomerId, page, searchTerm, controller.signal);
    return () => controller.abort();
  }, [activeTab, selectedCustomerId, page, searchTerm, loadUploadHistory]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSearchTerm(searchInput);
    setPage(1);
  };

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    setPage(1);
    setGroupedByMonth([]);
    setTotal(0);
    setTotalPages(0);
  };

  const noCustomerSelected = selectedCustomerId == null || selectedCustomerId === '';

  const loadCategoryChanges = async (uploadId) => {
    if (categoryChangesForId === uploadId) {
      setCategoryChangesForId(null);
      return;
    }
    try {
      const response = await axios.get(
        `${apiBase}/transactions/uploads/${uploadId}/category-changes`
      );
      setCategoryChangesList(response.data.changes || []);
      setCategoryChangesForId(uploadId);
    } catch (err) {
      toast(err.response?.data?.message || 'Error loading category changes', 'error');
    }
  };

  const handleResume = async (upload) => {
    const uploadId = typeof upload === 'object' ? upload.id : upload;
    const isRejected = typeof upload === 'object' && upload.status === 'rejected';
    try {
      setLoading(true);
      const response = await axios.get(
        `${apiBase}/transactions/uploads/${uploadId}/resume`
      );
      const { uploadId: id, fileName, columnMapping, transactions, currentStep, status } = response.data;
      if (isRejected) {
        const keyObservation = response.data.key_observation || '';
        const rejectionComment = response.data.rejection_comment || '';
        navigate('/upload-analytics', {
          state: {
            uploadId: id,
            fileName,
            columnMapping,
            transactions: (transactions || []).map((t) => ({
              ...t,
              category_name: t.category_name || t.categoryName || 'Uncategorized',
              category_id: t.category_id ?? t.categoryId,
            })),
            currentStep,
            uploadStatus: status,
            keyObservation,
            rejectionComment,
            fromHistory: true,
            currentUser: currentUser || null,
            customerName: (selectedCustomer && (selectedCustomer.name || selectedCustomer.email)) || null,
            periodMonth: upload.period_month ?? null,
            periodYear: upload.period_year ?? null,
          },
        });
      } else {
        navigate('/transactions', {
          state: {
            resume: true,
            uploadId: id,
            fileName,
            columnMapping,
            transactions,
            currentStep,
            status,
          },
        });
      }
    } catch (err) {
      toast(err.response?.data?.message || 'Error resuming upload', 'error');
    } finally {
      setLoading(false);
    }
  };

  const canDeleteInMonth = (monthGroup) => {
    return (
      monthGroup.overallStatus !== 'Approved' &&
      monthGroup.overallStatus !== 'Submitted for approval'
    );
  };

  const toggleMonthExpand = (key) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleDeleteUpload = async () => {
    if (!deleteConfirm) return;
    try {
      setDeleting(true);
      await axios.delete(`${apiBase}/transactions/uploads/${deleteConfirm.uploadId}`);
      toast('Statement deleted successfully', 'success');
      setDeleteConfirm(null);
      loadUploadHistory(activeTab, selectedCustomerId, page, searchTerm);
    } catch (err) {
      toast(err.response?.data?.message || 'Error deleting statement', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const getStatusLabel = (upload) => {
    if (upload.status === 'completed') return 'Approved';
    if (upload.status === 'rejected') return 'Rejected';
    if (upload.status === 'submitted') return 'Submitted for approval';
    if (upload.currentStep === 'review') return 'Review';
    if (upload.currentStep === 'categorize') return 'Categorization';
    if (upload.currentStep === 'upload') return 'Upload';
    return upload.currentStep || '—';
  };

  const getStatusBadgeClass = (upload) => {
    if (upload.status === 'completed') return 'upload-status-badge completed';
    if (upload.status === 'rejected') return 'upload-status-badge rejected';
    if (upload.status === 'submitted') return 'upload-status-badge submitted';
    if (upload.currentStep === 'review') return 'upload-status-badge review';
    if (upload.currentStep === 'categorize') return 'upload-status-badge categorize';
    return 'upload-status-badge upload';
  };

  const canResume = (upload) => {
    if (upload.status === 'completed') return false;
    if (upload.status === 'submitted') return false;
    return true;
  };

  // Month grouping, overall status, and suggested action come from backend (group_by_month=true)
  const handleReviewMonth = (monthGroup) => {
    const ids = monthGroup.uploads.map((u) => u.id);
    navigate('/transactions', {
      state: {
        reviewForMonth: true,
        periodMonth: monthGroup.periodMonth,
        periodYear: monthGroup.periodYear,
        uploadIds: ids,
      },
    });
  };

  const handleRowClick = async (upload) => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${apiBase}/transactions/uploads/${upload.id}/resume`
      );
      const { uploadId: id, fileName, columnMapping, transactions, currentStep, status } = response.data;
      const keyObservation = response.data.key_observation || '';
      const rejectionComment = response.data.rejection_comment || '';
      navigate('/upload-analytics', {
        state: {
          uploadId: id,
          fileName,
          columnMapping,
          transactions: (transactions || []).map((t) => ({
            ...t,
            category_name: t.category_name || t.categoryName || 'Uncategorized',
            category_id: t.category_id ?? t.categoryId,
          })),
          currentStep,
          uploadStatus: status,
          keyObservation,
          rejectionComment,
          fromHistory: true,
          currentUser: currentUser || null,
          customerName: (selectedCustomer && (selectedCustomer.name || selectedCustomer.email)) || null,
          periodMonth: upload.period_month ?? null,
          periodYear: upload.period_year ?? null,
        },
      });
    } catch (err) {
      toast(err.response?.data?.message || 'Error loading upload', 'error');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (dateString == null || dateString === '') return '—';
    try {
      const date = new Date(dateString);
      if (Number.isNaN(date.getTime())) return String(dateString);
      return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(dateString);
    }
  };

  if (loading && groupedByMonth.length === 0 && !noCustomerSelected) {
    return (
      <div className="app">
        <Navbar />
        <RequireCustomerGate>
          <div className="upload-history-container">
            <div className="loading-spinner">Loading budget history...</div>
          </div>
        </RequireCustomerGate>
      </div>
    );
  }

  return (
    <div className="app">
      <Navbar />
      <RequireCustomerGate>
        <div className="upload-history-container">
          <div className="upload-history-header">
            <h1>Budget History</h1>
            <p className="subtitle">View and resume your PDF uploads (for the selected customer)</p>
          </div>

          {noCustomerSelected ? (
            <div className="upload-history-empty upload-history-select-customer">
              <div className="empty-icon">👤</div>
              <h2>Select a customer</h2>
              <p>Choose a customer from the navbar to view Budget History for that customer.</p>
            </div>
          ) : (
            <>
          <div className="upload-history-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`upload-history-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => handleTabChange(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="upload-history-toolbar">
            <form onSubmit={handleSearchSubmit} className="upload-history-search-form">
              <input
                type="text"
                className="upload-history-search-input"
                placeholder="Search by file name"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <button type="submit" className="btn-primary btn-resume">Search</button>
            </form>
          </div>

          {groupedByMonth.length === 0 && !loading ? (
            <div className="upload-history-empty">
              <div className="empty-icon">📄</div>
              <h2>No uploads in this tab</h2>
              <p>Switch tabs or upload a PDF to get started</p>
              <button
                className="primary-button"
                onClick={() => navigate('/transactions')}
              >
                Upload PDF
              </button>
            </div>
          ) : (
            <>
              <div className="upload-history-table-wrap">
                <table className="upload-history-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Month</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedByMonth.map((monthGroup) => {
                      const isExpanded = expandedMonths.has(monthGroup.key);
                      return (
                        <React.Fragment key={monthGroup.key}>
                          {/* Month group (parent) row */}
                          <tr className="upload-history-month-row">
                            <td>{monthGroup.uploads[0]?.customer_name || selectedCustomer?.name || '—'}</td>
                            <td>
                              <button
                                type="button"
                                className="upload-history-expand-btn"
                                onClick={() => toggleMonthExpand(monthGroup.key)}
                                title={isExpanded ? 'Collapse' : `Expand — ${monthGroup.uploads.length} statement${monthGroup.uploads.length !== 1 ? 's' : ''}`}
                              >
                                <span className={`upload-history-chevron ${isExpanded ? 'expanded' : ''}`}>▶</span>
                                <strong>{monthGroup.monthLabel}</strong>
                                <span className="upload-history-child-count">{monthGroup.uploads.length}</span>
                              </button>
                            </td>
                            <td>
                              <span className={monthGroup.overallStatusBadgeClass}>
                                {monthGroup.overallStatus}
                              </span>
                            </td>
                            <td>{monthGroup.latestDate ? formatDate(monthGroup.latestDate) : '—'}</td>
                            <td className="upload-history-actions">
                              {monthGroup.suggestedAction === 'review' ? (
                                <button
                                  type="button"
                                  className="btn-primary btn-resume"
                                  onClick={() => handleReviewMonth(monthGroup)}
                                >
                                  Review
                                </button>
                              ) : monthGroup.suggestedAction === 'view_report' ? (
                                <button
                                  type="button"
                                  className="btn-primary btn-resume"
                                  onClick={() => handleRowClick(monthGroup.uploads.find((u) => u.status === 'completed') || monthGroup.uploads[0])}
                                >
                                  View Report
                                </button>
                              ) : monthGroup.suggestedAction === 'resume' ? (
                                <button
                                  type="button"
                                  className="btn-primary btn-resume"
                                  onClick={() => handleResume(monthGroup.uploads.find((u) => canResume(u)))}
                                >
                                  Resume
                                </button>
                              ) : monthGroup.suggestedAction === 'rejected' ? (
                                <button
                                  type="button"
                                  className="btn-resume btn-resubmit"
                                  onClick={() => handleResume(monthGroup.uploads.find((u) => u.status === 'rejected') || monthGroup.uploads[0])}
                                >
                                  View &amp; Re-submit
                                </button>
                              ) : (
                                <span className="upload-history-in-progress">In progress</span>
                              )}
                            </td>
                          </tr>
                          {/* Child statement rows — shown only when expanded */}
                          {isExpanded && monthGroup.uploads.map((upload) => (
                            <tr key={upload.id} className="upload-history-child-row">
                              <td />
                              <td className="upload-history-cell-filename upload-history-child-filename">
                                <span className="upload-history-child-icon">↳</span>
                                {upload.file_name || `Statement #${upload.id}`}
                              </td>
                              <td />
                              <td className="upload-history-child-date">
                                {upload.created_at ? formatDate(upload.created_at) : '—'}
                              </td>
                              <td className="upload-history-actions">
                                {canDeleteInMonth(monthGroup) ? (
                                  <button
                                    type="button"
                                    className="btn-delete-statement"
                                    onClick={() => setDeleteConfirm({ uploadId: upload.id, fileName: upload.file_name || `Statement #${upload.id}` })}
                                    title="Delete this statement"
                                  >
                                    Delete
                                  </button>
                                ) : (
                                  <span className="upload-history-delete-locked" title={`Cannot delete — month is ${monthGroup.overallStatus}`}>
                                    🔒
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 0 && groupedByMonth.length > 0 && (
                <div className="upload-history-pagination">
                  <span className="upload-history-pagination-info">
                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                  </span>
                  <div className="upload-history-pagination-controls">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                    >
                      Previous
                    </button>
                    <span className="upload-history-pagination-info" style={{ margin: 0 }}>
                      Page {page} of {totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              {categoryChangesForId && (
                <div className="category-changes-panel upload-history-changes">
                  <h4>Category changes during approval</h4>
                  {categoryChangesList.length === 0 ? (
                    <p className="no-changes">No categories were changed during approval.</p>
                  ) : (
                    <div className="category-changes-table-wrap">
                      <table className="category-changes-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Description</th>
                            <th>Amount</th>
                            <th>Was</th>
                            <th>Changed to</th>
                            <th>By</th>
                            <th>When</th>
                          </tr>
                        </thead>
                        <tbody>
                          {categoryChangesList.map((ch) => (
                            <tr key={ch.id}>
                              <td>{ch.date}</td>
                              <td>{ch.description}</td>
                              <td>{formatCurrency(ch.amount, selectedCustomer)}</td>
                              <td>{ch.old_category_name || '—'}</td>
                              <td>{ch.new_category_name || '—'}</td>
                              <td>{ch.changed_by_name || '—'}</td>
                              <td>{ch.changed_at ? new Date(ch.changed_at).toLocaleString() : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
            </>
          )}
        </div>
      </RequireCustomerGate>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="delete-modal-overlay" onClick={() => !deleting && setDeleteConfirm(null)}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-modal-icon">🗑️</div>
            <h3 className="delete-modal-title">Delete Statement?</h3>
            <p className="delete-modal-body">
              Are you sure you want to delete{' '}
              <strong>{deleteConfirm.fileName}</strong>? This action cannot be undone.
            </p>
            <div className="delete-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-delete-confirm"
                onClick={handleDeleteUpload}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadHistory;
