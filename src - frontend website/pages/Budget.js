import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

const Budget = () => {
  const { user } = useAuth();
  const { selectedCustomerId } = useCustomer();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const { toast } = useToast();

  const fetchCases = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCustomerId) params.append('customer_id', selectedCustomerId);
      if (filter) params.append('status', filter);
      const res = await axios.get(`${API}/budget-cases?${params.toString()}`);
      setCases(res.data.budget_cases || []);
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to load budget cases', 'error');
      setCases([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, [selectedCustomerId, filter]);

  const isRM = user?.role === 'RELATIONSHIP_MANAGER';
  const isTL = user?.role === 'TEAM_LEAD';
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  return (
    <div className="app">
      <Navbar />
      <RequireCustomerGate>
      <div className="dashboard-container">
        <div className="dashboard-content budget-page">
          <div className="page-header">
            <h1>Budget cases</h1>
            {(isRM || isAdmin) && (
              <Link to="/budget/new" className="btn-primary">
                New budget case
              </Link>
            )}
          </div>

          <div className="budget-toolbar">
            <label>Status</label>
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="All">
              <option value="">All</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </div>

          {loading ? (
            <p className="welcome-text">Loading...</p>
          ) : cases.length === 0 ? (
            <p className="welcome-text">No budget cases found.</p>
          ) : (
            <div className="budget-table-wrap">
              <table className="budget-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    {!isRM && <th>RM</th>}
                    <th>Period</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((bc) => (
                    <tr key={bc.id}>
                      <td>{bc.customer_name}</td>
                      {!isRM && <td>{bc.rm_name || bc.rm_email}</td>}
                      <td>{bc.period_month && bc.period_year ? `${bc.period_month}/${bc.period_year}` : '—'}</td>
                      <td>
                        <span className={`status-badge status-${bc.current_status}`}>
                          {STATUS_LABELS[bc.current_status] || bc.current_status}
                        </span>
                      </td>
                      <td>{bc.updated_at ? new Date(bc.updated_at).toLocaleString() : '—'}</td>
                      <td>
                        <Link to={`/budget/${bc.id}`} className="btn-secondary" style={{ padding: '0.35rem 0.75rem' }}>
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      </RequireCustomerGate>
    </div>
  );
};

export default Budget;
