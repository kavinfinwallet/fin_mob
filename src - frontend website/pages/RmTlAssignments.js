import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import Select from '../components/Select';
import { useAuth } from '../context/AuthContext';
import { useCustomer } from '../context/CustomerContext';
import { useToast } from '../context/ToastContext';
import './Dashboard.css';
import './Admin.css';
import './RmTlAssignments.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const RmTlAssignments = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { fetchCustomers: refreshGlobalCustomers } = useCustomer();
  const { toast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [assignableRms, setAssignableRms] = useState([]);
  const [customerToRm, setCustomerToRm] = useState({ customer_id: '', assigned_rm_id: '' });
  const [assignments, setAssignments] = useState([]);
  const [allUsersForAssignments, setAllUsersForAssignments] = useState([]);
  const [newAssignment, setNewAssignment] = useState({ tl_id: '', rm_id: '' });

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || user?.is_super_admin;

  const loadData = useCallback(async () => {
    try {
      const [assignRes, allUsersRes] = await Promise.all([
        axios.get(`${API}/auth/rm-tl-assignments`).catch(() => ({ data: { assignments: [] } })),
        axios.get(`${API}/auth/users?limit=500&page=1`).catch(() => ({ data: { users: [] } }))
      ]);
      setAssignments(assignRes.data.assignments || []);
      setAllUsersForAssignments(allUsersRes.data?.users || []);
    } catch (err) {
      toast(err.response?.data?.message || 'Error loading assignments', 'error');
    }
  }, [toast]);

  const loadCustomersAndRms = useCallback(async () => {
    try {
      const [custRes, rmsRes] = await Promise.all([
        axios.get(`${API}/customers`).catch(() => ({ data: { customers: [] } })),
        axios.get(`${API}/customers/assignable-rms`).catch(() => ({ data: { rms: [] } }))
      ]);
      setCustomers(custRes.data.customers || []);
      setAssignableRms(rmsRes.data.rms || []);
    } catch (err) {
      toast(err.response?.data?.message || 'Error loading customers/RMs', 'error');
    }
  }, [toast]);

  useEffect(() => {
    if (isAdmin) {
      loadData();
      loadCustomersAndRms();
    }
  }, [isAdmin, loadData, loadCustomersAndRms]);

  const handleAssignCustomerToRm = async (e) => {
    e.preventDefault();
    if (!customerToRm.customer_id || !customerToRm.assigned_rm_id) {
      toast('Select both customer and RM', 'error');
      return;
    }
    try {
      await axios.patch(`${API}/customers/${customerToRm.customer_id}`, {
        assigned_rm_id: parseInt(customerToRm.assigned_rm_id, 10)
      });
      await loadCustomersAndRms();
      refreshGlobalCustomers();
      setCustomerToRm({ customer_id: '', assigned_rm_id: '' });
      toast('Customer assigned to RM', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to assign customer', 'error');
    }
  };

  const handleAddAssignment = async (e) => {
    e.preventDefault();
    if (!newAssignment.tl_id || !newAssignment.rm_id) {
      toast('Select both TL and RM', 'error');
      return;
    }
    try {
      await axios.post(`${API}/auth/rm-tl-assignments`, newAssignment);
      await loadData();
      setNewAssignment({ tl_id: '', rm_id: '' });
      toast('RM assigned to TL', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to add assignment', 'error');
    }
  };

  const handleRemoveAssignment = async (rmId) => {
    try {
      await axios.delete(`${API}/auth/rm-tl-assignments/${rmId}`);
      await loadData();
      toast('Assignment removed', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to remove', 'error');
    }
  };

  if (!user) return null;
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  const tls = allUsersForAssignments.filter((u) => u.role === 'TEAM_LEAD' && u.enabled);
  const rms = allUsersForAssignments.filter((u) => u.role === 'RELATIONSHIP_MANAGER' && u.enabled);

  return (
    <div className="app">
      <Navbar />
      <div className="dashboard-container assignments-page">
        <div className="dashboard-content">
          <header className="assignments-header">
            <h1>Assignments</h1>
            <button type="button" className="assign-back" onClick={() => navigate('/admin')}>
              Back to Admin
            </button>
          </header>

          <section className="assign-card">
            <h2 className="assign-card__title">Assign customer to RM</h2>
            <p className="assign-card__desc">
              Reassign a customer to a different Relationship Manager.
            </p>
            <form onSubmit={handleAssignCustomerToRm} className="assign-form">
              <div className="assign-form__group">
                <label>Customer</label>
                <Select
                  value={customerToRm.customer_id}
                  onChange={(e) => setCustomerToRm({ ...customerToRm, customer_id: e.target.value })}
                  placeholder="Select customer"
                  required
                >
                  <option value="">Select customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.code ? `(${c.code})` : ''} {c.rm_name ? `— current: ${c.rm_name}` : ''}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="assign-form__group">
                <label>Assign to RM</label>
                <Select
                  value={customerToRm.assigned_rm_id}
                  onChange={(e) => setCustomerToRm({ ...customerToRm, assigned_rm_id: e.target.value })}
                  placeholder="Select RM"
                  required
                >
                  <option value="">Select RM</option>
                  {assignableRms.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} ({r.email})</option>
                  ))}
                </Select>
              </div>
              <button type="submit" className="assign-btn">Assign</button>
            </form>
          </section>

          <section className="assign-card">
            <h2 className="assign-card__title">Assign RM to TL</h2>
            <p className="assign-card__desc">
              Allocate Relationship Managers to Team Leads. To move an RM to another TL, assign them to the new TL (they will be unassigned from the previous TL).
            </p>
            {assignableRms.length === 0 && (
              <p className="assign-card__hint">
                Create RM users first (Users page).
              </p>
            )}
            <form onSubmit={handleAddAssignment} className="assign-form">
              <div className="assign-form__group">
                <label>Team Lead</label>
                <Select
                  value={newAssignment.tl_id}
                  onChange={(e) => setNewAssignment({ ...newAssignment, tl_id: e.target.value })}
                  placeholder="Select TL"
                  required
                >
                  <option value="">Select TL</option>
                  {tls.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.email})</option>
                  ))}
                </Select>
              </div>
              <div className="assign-form__group">
                <label>Relationship Manager</label>
                <Select
                  value={newAssignment.rm_id}
                  onChange={(e) => setNewAssignment({ ...newAssignment, rm_id: e.target.value })}
                  placeholder="Select RM"
                  required
                >
                  <option value="">Select RM</option>
                  {rms.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} ({r.email})</option>
                  ))}
                </Select>
              </div>
              <button type="submit" className="assign-btn">Assign</button>
            </form>

            <div className="assign-table-wrap">
              <div className="table-scroll-wrap">
                <div className="admin-users-table-wrap admin-users-table-wrap--scrollable">
                  <table className="admin-users-table admin-users-table--sticky-head">
                    <thead>
                      <tr>
                        <th>Team Lead</th>
                        <th>Relationship Manager</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--assign-muted)' }}>
                            No assignments yet.
                          </td>
                        </tr>
                      ) : (
                        assignments.map((a) => (
                          <tr key={a.id}>
                            <td>{a.tl_name} ({a.tl_email})</td>
                            <td>{a.rm_name} ({a.rm_email})</td>
                            <td>
                              <div className="actions-cell">
                                <button
                                  type="button"
                                  className="btn-secondary btn-row"
                                  onClick={() => handleRemoveAssignment(a.rm_id)}
                                >
                                  Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="admin-pagination admin-pagination--sticky">
                  <span className="admin-pagination-info">
                    {assignments.length} assignment{assignments.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default RmTlAssignments;
