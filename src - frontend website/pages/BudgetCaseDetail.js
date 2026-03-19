import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useCustomer } from '../context/CustomerContext';
import { useToast } from '../context/ToastContext';
import Navbar from '../components/Navbar';
import Select from '../components/Select';
import RequireCustomerGate from '../components/RequireCustomerGate';
import './Budget.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const STATUS_LABELS = {
  INITIATED: 'Initiated',
  RECEIVED: 'Received',
  STARTED: 'Started',
  PENDING_APPROVAL: 'Pending approval',
  VERIFIED: 'Verified',
  READY_FOR_CUSTOMER_DISCUSSION: 'Ready for customer discussion',
  COMPLETED_BUDGET_ANALYSIS: 'Completed'
};

const NEXT_ACTIONS = {
  INITIATED: [{ to: 'RECEIVED', label: 'Mark Received' }],
  RECEIVED: [{ to: 'STARTED', label: 'Mark Started' }],
  STARTED: [{ to: 'PENDING_APPROVAL', label: 'Submit for approval' }],
  PENDING_APPROVAL: [], // TL only: Approve / Reject
  VERIFIED: [{ to: 'READY_FOR_CUSTOMER_DISCUSSION', label: 'Ready for customer discussion' }],
  READY_FOR_CUSTOMER_DISCUSSION: [{ to: 'COMPLETED_BUDGET_ANALYSIS', label: 'Mark completed' }],
  COMPLETED_BUDGET_ANALYSIS: []
};

const BudgetCaseDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [budgetCase, setBudgetCase] = useState(null);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const { toast } = useToast();

  const isRM = user?.role === 'RELATIONSHIP_MANAGER';
  const isTL = user?.role === 'TEAM_LEAD';
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const canActAsRM = budgetCase && (budgetCase.created_by === user?.id || isAdmin);
  const canActAsTL = budgetCase && (isTL || isAdmin);

  const fetchDetail = async () => {
    if (id === 'new') return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/budget-cases/${id}`);
      setBudgetCase(res.data.budget_case || null);
      setAudit(res.data.audit || []);
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to load', 'error');
      setBudgetCase(null);
      setAudit([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id && id !== 'new') fetchDetail();
    else setLoading(false);
  }, [id]);

  const transition = async (toStatus, comment) => {
    setActionLoading(true);
    try {
      const res = await axios.patch(`${API}/budget-cases/${id}/status`, { to_status: toStatus, comment });
      setBudgetCase(res.data.budget_case);
      await fetchDetail();
      setRejectComment('');
      toast(res.data.message || 'Status updated', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Action failed', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (id === 'new') {
    return (
      <div className="app">
        <Navbar />
        <RequireCustomerGate>
        <div className="dashboard-container">
          <BudgetNew onCreated={(newId) => navigate(`/budget/${newId}`)} onCancel={() => navigate('/budget')} />
        </div>
        </RequireCustomerGate>
      </div>
    );
  }

  if (loading || !budgetCase) {
    return (
      <div className="app">
        <Navbar />
        <div className="dashboard-container">
          <div className="dashboard-content">
            {loading ? <p className="welcome-text">Loading...</p> : null}
          </div>
        </div>
      </div>
    );
  }

  const status = budgetCase.current_status;
  const nextActions = NEXT_ACTIONS[status] || [];
  const showApproveReject = status === 'PENDING_APPROVAL' && canActAsTL;

  return (
    <div className="app">
      <Navbar />
      <RequireCustomerGate>
      <div className="dashboard-container">
        <div className="dashboard-content">
          <div className="page-header">
            <h1>Budget case: {budgetCase.customer_name}</h1>
            <Link to="/budget" className="btn-secondary">Back to list</Link>
          </div>

          <div className="dashboard-card" style={{ marginBottom: '1.5rem' }}>
            <h2>Details</h2>
            <p><strong>Status</strong> <span className={`status-badge status-${status}`}>{STATUS_LABELS[status] || status}</span></p>
            <p><strong>Period</strong> {budgetCase.period_month && budgetCase.period_year ? `${budgetCase.period_month}/${budgetCase.period_year}` : '—'}</p>
            <p><strong>RM</strong> {budgetCase.rm_name || budgetCase.rm_email}</p>
            {budgetCase.rejection_comment && (
              <p><strong>TL comment (rejection)</strong> {budgetCase.rejection_comment}</p>
            )}
          </div>

          {(nextActions.length > 0 && canActAsRM) || showApproveReject ? (
            <div className="dashboard-card">
              <h2>Actions</h2>
              <div className="detail-actions">
                {nextActions.map((a) => (
                  <button
                    key={a.to}
                    className="btn-primary"
                    disabled={actionLoading}
                    onClick={() => transition(a.to)}
                  >
                    {a.label}
                  </button>
                ))}
                {showApproveReject && (
                  <>
                    <button
                      className="btn-primary"
                      disabled={actionLoading}
                      onClick={() => transition('VERIFIED')}
                    >
                      Approve
                    </button>
                    <div className="reject-comment">
                      <textarea
                        placeholder="Rejection comment (required)"
                        value={rejectComment}
                        onChange={(e) => setRejectComment(e.target.value)}
                      />
                      <button
                        className="btn-secondary"
                        style={{ marginTop: '0.5rem' }}
                        disabled={actionLoading || !rejectComment.trim()}
                        onClick={() => transition('REJECTED', rejectComment)}
                      >
                        Reject
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : null}

          <div className="dashboard-card" style={{ marginTop: '1.5rem' }}>
            <h2>Audit trail</h2>
            <ul className="audit-list">
              {audit.length === 0 ? (
                <li className="audit-item">No history yet.</li>
              ) : (
                audit.map((a) => (
                  <li key={a.id} className="audit-item">
                    <strong>{a.from_status ? `${a.from_status} → ` : ''}{a.to_status}</strong>
                    <div className="audit-meta">
                      {a.user_name} · {new Date(a.created_at).toLocaleString()}
                    </div>
                    {a.comment && <div className="audit-comment">{a.comment}</div>}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </div>
      </RequireCustomerGate>
    </div>
  );
};

function BudgetNew({ onCreated, onCancel }) {
  const { customers, fetchCustomers, selectedCustomerId } = useCustomer();
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({
    customer_id: selectedCustomerId ? String(selectedCustomerId) : '',
    period_month: '',
    period_year: new Date().getFullYear()
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchCustomers();
  }, []);

  useEffect(() => {
    if (selectedCustomerId) {
      setForm(prev => ({ ...prev, customer_id: String(selectedCustomerId) }));
    }
  }, [selectedCustomerId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_id) {
      toast('Select a customer', 'error');
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:5000/api'}/budget-cases`, {
        customer_id: form.customer_id,
        period_month: form.period_month || null,
        period_year: form.period_year || null
      });
      onCreated(res.data.budget_case.id);
      toast('Budget case created', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to create', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-content">
      <h1>New budget case</h1>
      <div className="dashboard-card" style={{ maxWidth: 420 }}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Customer</label>
            <Select
              value={form.customer_id}
              onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
              placeholder="— Select —"
              required
            >
              <option value="">— Select —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div className="form-group">
            <label>Period month (optional)</label>
            <input
              type="number"
              min="1"
              max="12"
              value={form.period_month}
              onChange={(e) => setForm({ ...form, period_month: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Period year (optional)</label>
            <input
              type="number"
              min="2020"
              max="2030"
              value={form.period_year}
              onChange={(e) => setForm({ ...form, period_year: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="submit" className="btn-primary" disabled={loading}>Create</button>
            <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default BudgetCaseDetail;
