import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import Select from '../components/Select';
import { MultiSelect } from 'primereact/multiselect';
import RequireCustomerGate from '../components/RequireCustomerGate';
import { useCustomer } from '../context/CustomerContext';
import { formatCurrency as formatCurrencyUtil } from '../constants/currencies';
import './Analytics.css';

const apiBase = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Normalize for Analytics (expects category_name)
function normalizeForAnalytics(txn) {
  const categoryName = txn.categoryName ?? txn.category_name ?? '';
  return {
    ...txn,
    category_name: (typeof categoryName === 'string' && categoryName.trim()) ? categoryName.trim() : 'Uncategorized',
  };
}

const Analytics = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedCustomerId, selectedCustomer } = useCustomer();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('all'); // all, month, year
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [actionLoading, setActionLoading] = useState(false);

  // Multi-select uploads for dashboard (when not in reviewState)
  const [uploadOptions, setUploadOptions] = useState([]);
  const [selectedUploadIds, setSelectedUploadIds] = useState([]);
  const [uploadOptionsLoading, setUploadOptionsLoading] = useState(false);

  // Review mode: opened from Transaction Review with latest upload data
  const reviewState = useMemo(() => {
    const s = location.state;
    if (!s || !s.reviewMode || !s.transactions) return null;
    return {
      uploadId: s.uploadId,
      transactions: (s.transactions || []).map(normalizeForAnalytics),
      uploadStatus: s.uploadStatus || '',
      currentUser: s.currentUser || null,
    };
  }, [location.state]);

  useEffect(() => {
    if (reviewState) {
      setTransactions(reviewState.transactions);
      setLoading(false);
    }
  }, [reviewState]);

  // Same flow for RM and TL: GET /transactions/uploads?customer_id=X (backend: RM = own uploads, TL = assigned RMs’ uploads)
  useEffect(() => {
    if (reviewState || !selectedCustomerId) {
      setUploadOptions([]);
      setSelectedUploadIds([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        setUploadOptionsLoading(true);
        const params = new URLSearchParams();
        params.set('customer_id', String(selectedCustomerId));
        params.set('tab', 'all');
        params.set('page', '1');
        params.set('limit', '100');
        const res = await axios.get(`${apiBase}/transactions/uploads?${params.toString()}`);
        if (cancelled) return;
        const opts = (res.data.uploads || []).map((u) => ({
          label: `${u.file_name} (${u.status})`,
          value: u.id,
        }));
        setUploadOptions(opts);
      } catch {
        if (!cancelled) setUploadOptions([]);
      } finally {
        if (!cancelled) setUploadOptionsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [reviewState, selectedCustomerId]);

  // Data flow (same for RM and TL): customer-scoped uploads list, then either all customer transactions
  // or selected-upload transactions. Backend returns RM = own uploads, TL = assigned RMs' uploads for same customer.
  useEffect(() => {
    if (reviewState) return;
    if (!selectedUploadIds || selectedUploadIds.length === 0) {
      setLoading(true);
      loadTransactions();
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const ids = selectedUploadIds.join(',');
        // Same flow for RM and TL: GET /uploads/transactions (TL can pass upload_ids from dropdown = assigned RMs’ uploads)
        const res = await axios.get(`${apiBase}/transactions/uploads/transactions?upload_ids=${ids}&status=approved`);
        if (cancelled) return;
        const list = (res.data.transactions || []).map(normalizeForAnalytics);
        setTransactions(list);
      } catch {
        if (!cancelled) setTransactions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [reviewState, selectedUploadIds, selectedCustomerId]);

  const handleSubmitForApproval = async () => {
    if (!reviewState || !reviewState.uploadId) return;
    setActionLoading(true);
    try {
      await axios.post(`${apiBase}/transactions/submit`, {
        uploadId: reviewState.uploadId,
        transactions: reviewState.transactions.map(t => ({
          ...t,
          categoryName: t.category_name,
          categoryId: t.category_id,
        })),
      });
      navigate('/transactions', { replace: true });
    } catch (err) {
      console.error('Submit for approval failed:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproval = async () => {
    if (!reviewState || !reviewState.uploadId) return;
    setActionLoading(true);
    try {
      await axios.post(`${apiBase}/transactions/save`, {
        uploadId: reviewState.uploadId,
        transactions: reviewState.transactions.map(t => ({
          ...t,
          categoryName: t.category_name,
          categoryId: t.category_id,
        })),
      });
      navigate('/transactions', { replace: true });
    } catch (err) {
      console.error('Approve & save failed:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleBackToReview = () => {
    navigate('/transactions', {
      state: {
        resume: true,
        uploadId: reviewState?.uploadId,
        transactions: reviewState?.transactions,
        currentStep: 'review',
        status: reviewState?.uploadStatus,
      },
    });
  };

  const isAdmin = reviewState?.currentUser && (
    reviewState.currentUser.role === 'SUPER_ADMIN' ||
    reviewState.currentUser.role === 'ADMIN' ||
    reviewState.currentUser.role === 'TEAM_LEAD' ||
    reviewState.currentUser.is_super_admin
  );
  const isRM = reviewState?.currentUser?.role === 'RELATIONSHIP_MANAGER';
  const canSubmit = isRM && reviewState?.uploadStatus !== 'submitted' && reviewState?.uploadStatus !== 'completed';
  const canApprove = isAdmin && reviewState?.uploadStatus !== 'completed';

  // Same flow for RM and TL: GET /transactions?customer_id=X (backend scopes by role: RM = own, TL = assigned RMs)
  const loadTransactions = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedCustomerId) params.set('customer_id', String(selectedCustomerId));
      const url = params.toString() ? `${apiBase}/transactions?${params.toString()}` : `${apiBase}/transactions`;
      const response = await axios.get(url);
      const list = response.data.transactions || [];
      setTransactions(list.map(normalizeForAnalytics));
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter transactions based on date range and category (in review mode include all, else approved only)
  const filteredTransactions = useMemo(() => {
    let filtered = reviewState
      ? transactions
      : transactions.filter(txn => txn.status === 'approved');

    // Filter by date range
    if (dateRange === 'month') {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      filtered = filtered.filter(txn => new Date(txn.date) >= firstDay);
    } else if (dateRange === 'year') {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), 0, 1);
      filtered = filtered.filter(txn => new Date(txn.date) >= firstDay);
    }
    
    // Filter by category
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(txn => txn.category_name === selectedCategory);
    }
    
    return filtered;
  }, [transactions, dateRange, selectedCategory, reviewState]);

  // Calculate statistics
  const stats = useMemo(() => {
    const credits = filteredTransactions.filter(t => t.type === 'credit');
    const debits = filteredTransactions.filter(t => t.type === 'debit');
    
    const totalIncome = credits.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const totalExpenses = debits.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const balance = totalIncome - totalExpenses;
    const transactionCount = filteredTransactions.length;
    
    return {
      totalIncome,
      totalExpenses,
      balance,
      transactionCount,
      credits: credits.length,
      debits: debits.length
    };
  }, [filteredTransactions]);

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
    const breakdown = {};
    
    filteredTransactions.forEach(txn => {
      const category = txn.category_name || 'Uncategorized';
      if (!breakdown[category]) {
        breakdown[category] = { amount: 0, count: 0, type: txn.type };
      }
      breakdown[category].amount += parseFloat(txn.amount || 0);
      breakdown[category].count += 1;
    });
    
    return Object.entries(breakdown)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredTransactions]);

  // Monthly trends
  const monthlyTrends = useMemo(() => {
    const trends = {};
    
    filteredTransactions.forEach(txn => {
      const date = new Date(txn.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      
      if (!trends[monthKey]) {
        trends[monthKey] = {
          month: monthName,
          income: 0,
          expenses: 0,
          count: 0
        };
      }
      
      if (txn.type === 'credit') {
        trends[monthKey].income += parseFloat(txn.amount || 0);
      } else {
        trends[monthKey].expenses += parseFloat(txn.amount || 0);
      }
      trends[monthKey].count += 1;
    });
    
    return Object.values(trends)
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12); // Last 12 months
  }, [filteredTransactions]);

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set();
    filteredTransactions.forEach(txn => {
      if (txn.category_name) {
        cats.add(txn.category_name);
      }
    });
    return Array.from(cats).sort();
  }, [filteredTransactions]);

  const formatCurrency = (amount) => formatCurrencyUtil(amount, selectedCustomer);

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

  // Calculate max amount for chart scaling
  const maxCategoryAmount = useMemo(() => {
    if (categoryBreakdown.length === 0) return 1;
    return Math.max(...categoryBreakdown.map(c => c.amount));
  }, [categoryBreakdown]);

  const maxMonthlyAmount = useMemo(() => {
    if (monthlyTrends.length === 0) return 1;
    return Math.max(
      ...monthlyTrends.map(m => Math.max(m.income, m.expenses))
    );
  }, [monthlyTrends]);

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
      <div className="analytics-container">
        <div className="analytics-header">
          <h1>{reviewState ? 'Upload analytics' : 'Analytics Dashboard'}</h1>
          <p className="analytics-subtitle">
            {reviewState
              ? `This upload only — ${reviewState.transactions.length} transaction${reviewState.transactions.length !== 1 ? 's' : ''}. Submit for approval or approve & save below.`
              : 'Insights into your financial transactions'}
          </p>
        </div>

        {reviewState && (
          <div className="analytics-review-banner">
            This page shows analytics for this upload only, not your overall account. Use filters to explore, then submit for approval or approve & save.
          </div>
        )}

        {/* Filters */}
        <div className="analytics-filters">
          {!reviewState && selectedCustomerId && (
            <div className="filter-group analytics-upload-multiselect-group">
              <label>Upload(s)</label>
              <MultiSelect
                value={selectedUploadIds}
                options={uploadOptions}
                optionLabel="label"
                optionValue="value"
                placeholder={uploadOptionsLoading ? 'Loading…' : 'Select uploads to view data'}
                display="chip"
                className="analytics-upload-multiselect"
                disabled={uploadOptionsLoading || loading}
                onChange={(e) => setSelectedUploadIds(e.value || [])}
              />
            </div>
          )}
          <div className="filter-group">
            <label>Time Period</label>
            <Select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Time</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
            </Select>
          </div>
          <div className="filter-group">
            <label>Category</label>
            <Select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </Select>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="stats-grid">
          <div className="stat-card income-card">
            <div className="stat-icon">💰</div>
            <div className="stat-content">
              <h3>Total Income</h3>
              <p className="stat-value">{formatCurrency(stats.totalIncome)}</p>
              <span className="stat-label">{stats.credits} transactions</span>
            </div>
          </div>

          <div className="stat-card expense-card">
            <div className="stat-icon">💸</div>
            <div className="stat-content">
              <h3>Total Expenses (Inc Expenses & Investments)</h3>
              <p className="stat-value">{formatCurrency(stats.totalExpenses)}</p>
              <span className="stat-label">{stats.debits} transactions</span>
            </div>
          </div>

          <div className="stat-card balance-card">
            <div className="stat-icon">💵</div>
            <div className="stat-content">
              <h3>Net Balance</h3>
              <p className={`stat-value ${stats.balance >= 0 ? 'positive' : 'negative'}`}>
                {formatCurrency(stats.balance)}
              </p>
              <span className="stat-label">Income - Expenses</span>
            </div>
          </div>

          <div className="stat-card count-card">
            <div className="stat-icon">📊</div>
            <div className="stat-content">
              <h3>Transactions</h3>
              <p className="stat-value">{stats.transactionCount}</p>
              <span className="stat-label">Total count</span>
            </div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="charts-grid">
          {/* Category Breakdown */}
          <div className="chart-card">
            <h2>Spending by Category</h2>
            <div className="chart-content">
              {categoryBreakdown.length > 0 ? (
                <div className="category-chart">
                  {categoryBreakdown.slice(0, 10).map((category, index) => (
                    <div key={category.name} className="category-bar-item">
                      <div className="category-info">
                        <span className="category-name">{category.name}</span>
                        <span className="category-amount">{formatCurrency(category.amount)}</span>
                      </div>
                      <div className="category-bar-container">
                        <div
                          className="category-bar"
                          style={{
                            width: `${(category.amount / maxCategoryAmount) * 100}%`,
                            backgroundColor: `hsl(${index * 30}, 70%, 50%)`
                          }}
                        />
                      </div>
                      <span className="category-count">{category.count} transactions</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-data">No category data available</div>
              )}
            </div>
          </div>

          {/* Monthly Trends */}
          <div className="chart-card">
            <h2>Monthly Trends</h2>
            <div className="chart-content">
              {monthlyTrends.length > 0 ? (
                <div className="trends-chart">
                  {monthlyTrends.map((month, index) => (
                    <div key={month.month} className="trend-month">
                      <div className="trend-bars">
                        <div className="trend-bar-container">
                          <div
                            className="trend-bar income-bar"
                            style={{
                              height: `${(month.income / maxMonthlyAmount) * 100}%`
                            }}
                            title={`Income: ${formatCurrency(month.income)}`}
                          />
                          <span className="trend-label">{formatCurrency(month.income)}</span>
                        </div>
                        <div className="trend-bar-container">
                          <div
                            className="trend-bar expense-bar"
                            style={{
                              height: `${(month.expenses / maxMonthlyAmount) * 100}%`
                            }}
                            title={`Expenses: ${formatCurrency(month.expenses)}`}
                          />
                          <span className="trend-label">{formatCurrency(month.expenses)}</span>
                        </div>
                      </div>
                      <span className="trend-month-name">{month.month}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-data">No trend data available</div>
              )}
            </div>
          </div>
        </div>

        {/* Category Pie Chart (Visual) */}
        <div className="chart-card full-width">
          <h2>Category Distribution</h2>
          <div className="chart-content">
            {categoryBreakdown.length > 0 ? (
              <div className="category-list">
                {categoryBreakdown.map((category, index) => {
                  const percentage = (category.amount / categoryBreakdown.reduce((sum, c) => sum + c.amount, 0)) * 100;
                  return (
                    <div key={category.name} className="category-item">
                      <div className="category-item-header">
                        <div className="category-color" style={{ backgroundColor: `hsl(${index * 30}, 70%, 50%)` }} />
                        <span className="category-item-name">{category.name}</span>
                        <span className="category-item-percentage">{percentage.toFixed(1)}%</span>
                      </div>
                      <div className="category-item-bar">
                        <div
                          className="category-item-fill"
                          style={{
                            width: `${percentage}%`,
                            backgroundColor: `hsl(${index * 30}, 70%, 50%)`
                          }}
                        />
                      </div>
                      <div className="category-item-footer">
                        <span>{formatCurrency(category.amount)}</span>
                        <span>{category.count} transactions</span>
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

        {/* Recent Transactions / Upload transactions */}
        <div className="chart-card full-width">
          <h2>{reviewState ? 'Transactions in this upload' : 'Recent Transactions'}</h2>
          <div className="chart-content">
            {filteredTransactions.slice(0, 10).length > 0 ? (
              <div className="recent-transactions">
                <table className="transactions-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Category</th>
                      <th>Type</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.slice(0, 10).map((txn) => (
                      <tr key={txn.id}>
                        <td>{formatDate(txn.date)}</td>
                        <td className="description-cell">{txn.description}</td>
                        <td>
                          <span className="category-badge">{txn.category_name || 'Uncategorized'}</span>
                        </td>
                        <td>
                          <span className={`type-badge ${txn.type}`}>{txn.type}</span>
                        </td>
                        <td className={txn.type === 'credit' ? 'amount credit' : 'amount debit'}>
                          {txn.type === 'credit' ? '+' : '-'}{formatCurrency(txn.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="no-data">No transactions found</div>
            )}
          </div>
        </div>

        {reviewState && (
          <div className="analytics-review-actions">
            <button type="button" className="analytics-btn secondary" onClick={handleBackToReview} disabled={actionLoading}>
              Back to review
            </button>
            {canSubmit && (
              <button type="button" className="analytics-btn secondary" onClick={handleSubmitForApproval} disabled={actionLoading}>
                {actionLoading ? 'Submitting...' : 'Submit for Approval'}
              </button>
            )}
            {canApprove && (
              <button type="button" className="analytics-btn primary" onClick={handleApproval} disabled={actionLoading}>
                {actionLoading ? 'Saving...' : 'Approve & Save'}
              </button>
            )}
          </div>
        )}
      </div>
      </RequireCustomerGate>
    </div>
  );
};

export default Analytics;

