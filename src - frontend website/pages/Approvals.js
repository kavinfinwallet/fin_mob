import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import RequireCustomerGate from '../components/RequireCustomerGate';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCustomer } from '../context/CustomerContext';
import './UploadHistory.css';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'wait_for_approval', label: 'Wait for approval' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

const apiBase = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const PAGE_SIZE = 100;

const Approvals = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { selectedCustomerId, selectedCustomer } = useCustomer();
  const [uploads, setUploads] = useState([]);
  const [groupedByMonthFromApi, setGroupedByMonthFromApi] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('wait_for_approval');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const isAdminRole =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'TEAM_LEAD' ||
    user?.is_super_admin;
  const isTL = user?.role === 'TEAM_LEAD';

  const loadApprovals = useCallback(
    async (tab, customerId, pageNum, search, signal) => {
      if (!isAdminRole) {
        setUploads([]);
        setLoading(false);
        return;
      }
      // TL can load without customer (sees all budgets from assigned RMs). Admin can optionally filter by customer.
      if (!isTL && (customerId == null || customerId === '')) {
        setUploads([]);
        setTotal(0);
        setTotalPages(0);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (customerId != null && customerId !== '') {
          params.set('customer_id', String(customerId));
        }
        params.set('tab', tab || 'wait_for_approval');
        params.set('page', String(pageNum));
        params.set('limit', String(PAGE_SIZE));
        params.set('group_by_month', 'true');
        if (search && search.trim()) params.set('search', search.trim());
        const response = await axios.get(`${apiBase}/transactions/approvals?${params.toString()}`, { signal });
        if (signal?.aborted) return;
        if (response.data.grouped_by_month != null) {
          setGroupedByMonthFromApi(response.data.grouped_by_month || []);
          setUploads([]);
        } else {
          const list = response.data.uploads || [];
          const filtered =
            customerId != null && customerId !== ''
              ? list.filter((u) => String(u.customer_id) === String(customerId))
              : list;
          setUploads(filtered);
          setGroupedByMonthFromApi([]);
        }
        setTotal(response.data.total ?? 0);
        setTotalPages(response.data.total_pages ?? 1);
      } catch (err) {
        if (axios.isCancel(err) || err.name === 'AbortError') return;
        toast(err.response?.data?.message || 'Error loading approvals', 'error');
        setUploads([]);
        setGroupedByMonthFromApi([]);
        setTotal(0);
        setTotalPages(0);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [isAdminRole, isTL, toast]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadApprovals(activeTab, selectedCustomerId, page, searchTerm, controller.signal);
    return () => controller.abort();
  }, [activeTab, selectedCustomerId, page, searchTerm, loadApprovals]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSearchTerm(searchInput);
    setPage(1);
  };

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    setPage(1);
    setUploads([]);
    setGroupedByMonthFromApi([]);
    setTotal(0);
    setTotalPages(0);
  };

  const noCustomerSelected = selectedCustomerId == null || selectedCustomerId === '';

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

  const getStatusLabel = (upload) => {
    if (upload.status === 'completed') return 'Approved';
    if (upload.status === 'rejected') return 'Rejected';
    if (upload.status === 'submitted') return 'Submitted for approval';
    return upload.status || '—';
  };

  const getStatusBadgeClass = (upload) => {
    if (upload.status === 'completed') return 'upload-status-badge completed';
    if (upload.status === 'rejected') return 'upload-status-badge rejected';
    if (upload.status === 'submitted') return 'upload-status-badge submitted';
    return 'upload-status-badge upload';
  };

  const isUploadInProcess = (upload) =>
    upload.status === 'processing' || upload.currentStep === 'upload';

  const getMonthOverallStatus = (list) => {
    if (!list || list.length === 0) return { label: '—', badgeClass: 'upload-status-badge' };
    const anyInProcess = list.some((u) => isUploadInProcess(u));
    if (anyInProcess) return { label: 'In progress', badgeClass: 'upload-status-badge upload' };
    const allCompleted = list.every((u) => u.status === 'completed');
    if (allCompleted) return { label: 'Approved', badgeClass: 'upload-status-badge completed' };
    const allRejected = list.every((u) => u.status === 'rejected');
    if (allRejected) return { label: 'Rejected', badgeClass: 'upload-status-badge rejected' };
    const anySubmitted = list.some((u) => u.status === 'submitted');
    if (anySubmitted) return { label: 'Submitted for approval', badgeClass: 'upload-status-badge submitted' };
    return { label: 'Ready for review', badgeClass: 'upload-status-badge review' };
  };

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const groupedByMonth = React.useMemo(() => {
    const map = new Map();
    (uploads || []).forEach((u) => {
      const month = u.period_month != null ? Number(u.period_month) : new Date(u.created_at).getMonth() + 1;
      const year = u.period_year != null ? Number(u.period_year) : new Date(u.created_at).getFullYear();
      const key = `${year}-${String(month).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, { periodMonth: month, periodYear: year, uploads: [] });
      map.get(key).uploads.push(u);
    });
    return Array.from(map.entries())
      .map(([key, { periodMonth, periodYear, uploads: list }]) => {
        const sorted = list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const latestDate =
          sorted.length > 0
            ? sorted.reduce(
                (max, u) => (new Date(u.created_at) > max ? new Date(u.created_at) : max),
                new Date(0)
              )
            : null;
        const status = getMonthOverallStatus(sorted);
        return {
          key,
          periodMonth,
          periodYear,
          monthLabel: `${MONTH_NAMES[periodMonth - 1] || periodMonth} ${periodYear}`,
          uploads: sorted,
          latestDate,
          overallStatus: status.label,
          overallStatusBadgeClass: status.badgeClass,
        };
      })
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [uploads]);

  const handleReview = async (upload) => {
    try {
      const response = await axios.get(
        `${apiBase}/transactions/approval-detail/${upload.id}`
      );
      const { transactions } = response.data;
      navigate('/upload-analytics', {
        state: {
          uploadId: upload.id,
          transactions: (transactions || []).map((t) => ({
            ...t,
            category_name: t.categoryName || t.category_name || 'Uncategorized',
            category_id: t.categoryId ?? t.category_id,
          })),
          uploadStatus: upload.status || 'submitted',
          currentUser: user,
          customerName: upload.customer_name || selectedCustomer?.name || null,
          periodMonth: upload.period_month ?? null,
          periodYear: upload.period_year ?? null,
        },
      });
    } catch (err) {
      toast(err.response?.data?.message || 'Error loading upload', 'error');
    }
  };

  const handleRowClick = (monthGroup) => {
    const submitted = monthGroup.uploads.find((u) => u.status === 'submitted');
    const completed = monthGroup.uploads.find((u) => u.status === 'completed');
    const rejected = monthGroup.uploads.find((u) => u.status === 'rejected');
    const upload = submitted || completed || rejected || monthGroup.uploads[0];
    if (upload) handleReview(upload);
  };

  // Derive action from uploads when backend suggestedAction is missing (e.g. client-side grouping)
  const getSuggestedActionFromUploads = (monthGroup) => {
    const list = monthGroup.uploads || [];
    if (list.some((u) => u.status === 'submitted')) return 'review_approve';
    if (list.some((u) => u.status === 'completed')) return 'view_report';
    if (list.some((u) => u.status === 'rejected')) return 'view';
    return null;
  };

  const getActionButton = (monthGroup) => {
    const fromApi = monthGroup.suggestedAction;
    const action = (fromApi && fromApi !== '—') ? fromApi : getSuggestedActionFromUploads(monthGroup);
    if (action === 'review_approve') {
      return (
        <button
          type="button"
          className="btn-primary btn-resume"
          onClick={() => handleRowClick(monthGroup)}
        >
          {isTL ? 'Review' : 'Review & Approve'}
        </button>
      );
    }
    if (action === 'view_report') {
      return (
        <button
          type="button"
          className="btn-primary btn-resume"
          onClick={() => handleRowClick(monthGroup)}
        >
          View Report
        </button>
      );
    }
    if (action === 'view') {
      return (
        <button
          type="button"
          className="btn-primary btn-resume"
          onClick={() => handleRowClick(monthGroup)}
        >
          View
        </button>
      );
    }
    return <span className="upload-history-in-progress">—</span>;
  };

  const displayGroups = groupedByMonthFromApi.length > 0 ? groupedByMonthFromApi : groupedByMonth;

  if (!isAdminRole) {
    return (
      <div className="app">
        <Navbar />
        <div className="upload-history-container">
          <h1>Approvals</h1>
          <p>You do not have permission to view this page.</p>
        </div>
      </div>
    );
  }

  const approvalsContent = (
    <div className="upload-history-container">
      <div className="upload-history-header">
        <h1>Approvals</h1>
        <p className="subtitle">
          {isTL
            ? 'Budgets for the month submitted by RMs assigned to you. Optionally filter by customer.'
            : 'Review and approve budgets by customer and month'}
        </p>
      </div>

      {!isTL && noCustomerSelected ? (
        <div className="upload-history-empty upload-history-select-customer">
          <div className="empty-icon">👤</div>
          <h2>Select a customer</h2>
          <p>Choose a customer from the navbar to view approvals for that customer.</p>
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
                placeholder="Search by file name or customer"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <button type="submit" className="btn-primary btn-resume">
                Search
              </button>
            </form>
          </div>

          {displayGroups.length === 0 && !loading ? (
            <div className="upload-history-empty">
              <div className="empty-icon">✅</div>
              <h2>No uploads in this tab</h2>
              <p>
                {isTL && activeTab === 'wait_for_approval'
                  ? 'No budgets submitted by your assigned RMs for approval.'
                  : activeTab === 'wait_for_approval'
                    ? 'No budgets waiting for approval for this customer.'
                    : 'Switch tabs or select another customer.'}
              </p>
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
                    {displayGroups.map((monthGroup) => (
                      <tr key={monthGroup.key}>
                        <td>
                          {monthGroup.uploads[0]?.customer_name ||
                            selectedCustomer?.name ||
                            '—'}
                        </td>
                        <td>{monthGroup.monthLabel}</td>
                        <td>
                          <span className={monthGroup.overallStatusBadgeClass}>
                            {monthGroup.overallStatus}
                          </span>
                        </td>
                        <td>
                          {monthGroup.latestDate
                            ? formatDate(monthGroup.latestDate)
                            : '—'}
                        </td>
                        <td className="upload-history-actions">
                          {getActionButton(monthGroup)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 0 && displayGroups.length > 0 && (
                <div className="upload-history-pagination">
                  <span className="upload-history-pagination-info">
                    Showing {(page - 1) * PAGE_SIZE + 1}–
                    {Math.min(page * PAGE_SIZE, total)} of {total}
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
            </>
          )}
        </>
      )}
    </div>
  );

  if (loading && uploads.length === 0 && groupedByMonthFromApi.length === 0) {
    return (
      <div className="app">
        <Navbar />
        {isTL ? (
          <div className="upload-history-container">
            <div className="loading-spinner">Loading approvals...</div>
          </div>
        ) : (
          <RequireCustomerGate>
            <div className="upload-history-container">
              <div className="loading-spinner">Loading approvals...</div>
            </div>
          </RequireCustomerGate>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <Navbar />
      {isTL ? approvalsContent : <RequireCustomerGate>{approvalsContent}</RequireCustomerGate>}
    </div>
  );
};

export default Approvals;
