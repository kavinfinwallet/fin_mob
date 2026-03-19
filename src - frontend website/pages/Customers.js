import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import Select from '../components/Select';
import { useAuth } from '../context/AuthContext';
import { useCustomer } from '../context/CustomerContext';
import { useToast } from '../context/ToastContext';
import { CURRENCIES } from '../constants/currencies';
import './Dashboard.css';
import './Customers.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const Customers = () => {
  const { user } = useAuth();
  const { fetchCustomers: refreshGlobalCustomers } = useCustomer();
  const [customers, setCustomers] = useState([]);
  const [rms, setRms] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [loading, setLoading] = useState(false);
  const [expandedRmId, setExpandedRmId] = useState(null);
  const [togglingCustomerId, setTogglingCustomerId] = useState(null);
  const { toast } = useToast();

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || user?.is_super_admin;
  const isTL = user?.role === 'TEAM_LEAD';

  const rmIdToTl = useMemo(() => {
    const map = {};
    assignments.forEach((a) => {
      map[a.rm_id] = { tl_name: a.tl_name, tl_email: a.tl_email };
    });
    return map;
  }, [assignments]);

  const customersByRm = useMemo(() => {
    const map = {};
    customers.forEach((c) => {
      const rmId = c.assigned_rm_id;
      if (rmId) {
        if (!map[rmId]) map[rmId] = [];
        map[rmId].push(c);
      }
    });
    return map;
  }, [customers]);

  const loadCustomers = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/customers?activeOnly=true`);
      setCustomers(response.data.customers || []);
      refreshGlobalCustomers();
    } catch (err) {
      toast(err.response?.data?.message || 'Error loading customers', 'error');
    }
  }, [toast, refreshGlobalCustomers]);

  const loadAssignableRms = useCallback(async () => {
    if (!isAdmin && !isTL) return;
    try {
      const response = await axios.get(`${API}/customers/assignable-rms`);
      setRms(response.data.rms || []);
    } catch (err) {
      console.warn('Failed to load RMs:', err);
    }
  }, [isAdmin, isTL]);

  const loadAssignments = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const response = await axios.get(`${API}/auth/rm-tl-assignments`);
      setAssignments(response.data.assignments || []);
    } catch (err) {
      console.warn('Failed to load RM–TL assignments:', err);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    loadAssignableRms();
  }, [loadAssignableRms]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  const toggleRmExpand = (rmId) => {
    setExpandedRmId((prev) => (prev === rmId ? null : rmId));
  };

  if (user?.role === 'RELATIONSHIP_MANAGER') {
    return <Navigate to="/dashboard" replace />;
  }

  const startEdit = (c) => {
    setEditing(c.id);
    setEditForm({
      name: c.name,
      code: c.code || '',
      email: c.email || '',
      description: c.description || '',
      contact_details: c.contact_details || '',
      status: c.status || 'Active',
      assigned_rm_id: c.assigned_rm_id ? String(c.assigned_rm_id) : '',
      currency_code: c.currency_code || 'INR',
      currency_symbol: c.currency_symbol != null && c.currency_symbol !== '' ? c.currency_symbol : '₹'
    });
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditForm({});
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'currency_code') {
        const cur = CURRENCIES.find((c) => c.code === value);
        if (cur) next.currency_symbol = cur.symbol;
      }
      return next;
    });
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editForm.name) {
      toast('Customer name is required', 'error');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        name: editForm.name,
        code: editForm.code || null,
        email: editForm.email || null,
        description: editForm.description || null,
        contact_details: editForm.contact_details || null,
        status: editForm.status,
        currency_code: editForm.currency_code || 'INR',
        currency_symbol: editForm.currency_symbol != null && editForm.currency_symbol !== '' ? editForm.currency_symbol : '₹'
      };
      if (isAdmin) payload.assigned_rm_id = editForm.assigned_rm_id ? parseInt(editForm.assigned_rm_id, 10) : null;
      await axios.patch(`${API}/customers/${editing}`, payload);
      setEditing(null);
      setEditForm({});
      await loadCustomers();
      toast('Customer updated successfully', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Error updating customer', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleVisibleToRm = async (e, c) => {
    e.stopPropagation();
    const currentlyVisible = c.visible_to_rm !== false;
    const newVisible = !currentlyVisible;
    setTogglingCustomerId(c.id);
    try {
      await axios.patch(`${API}/customers/${c.id}`, { visible_to_rm: newVisible });
      await loadCustomers();
      toast(newVisible ? 'Customer is now visible to RM' : 'Customer is now hidden from RM', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to update visibility', 'error');
    } finally {
      setTogglingCustomerId(null);
    }
  };

  return (
    <div className="app customers-page">
      <Navbar />
      <div className="dashboard-container">
        <div className="dashboard-content">
          <header className="page-header">
            <h1>RM&apos;s Details</h1>
          </header>

          <div className="customers-layout">
          <section className="customers-table-section rms-details-section">
            <h2 className="customers-section-title">{isTL ? 'RMs allocated to you' : 'RMs and allocated customers'}</h2>
            {rms.length === 0 ? (
              <div className="customers-empty">
                {isTL ? 'No RMs allocated to you yet. Contact Admin.' : 'No RMs available. Create RM users in Admin first.'}
              </div>
            ) : (
              <div className="customers-table-wrap rms-table-wrap">
                <table className="customers-table rms-table">
                  <thead>
                    <tr>
                      <th className="col-expand" aria-label="Expand row" />
                      <th>RM Name</th>
                      <th>Email</th>
                      <th>Allocated TL</th>
                      <th>Customers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rms.map((rm) => {
                      const rmCustomers = customersByRm[rm.id] || [];
                      const isExpanded = expandedRmId === rm.id;
                      const tl = isAdmin ? rmIdToTl[rm.id] : (isTL ? { tl_name: user?.name, tl_email: user?.email } : null);
                      return (
                        <React.Fragment key={rm.id}>
                          <tr
                            className={`rm-row ${isExpanded ? 'rm-row-expanded' : ''}`}
                            onClick={() => toggleRmExpand(rm.id)}
                          >
                            <td className="col-expand">
                              <span className="rm-expand-icon" aria-hidden>{isExpanded ? '▼' : '▶'}</span>
                            </td>
                            <td className="col-name">{rm.name}</td>
                            <td>{rm.email}</td>
                            <td>{tl ? `${tl.tl_name || '—'} (${tl.tl_email || ''})` : '—'}</td>
                            <td>{rmCustomers.length}</td>
                          </tr>
                          {isExpanded && (
                            <tr className="rm-detail-row">
                              <td colSpan={5} className="rm-detail-cell">
                                <div className="rm-customers-inner">
                                  {rmCustomers.length === 0 ? (
                                    <p className="rm-customers-empty">No customers allocated to this RM.</p>
                                  ) : (
                                    <table className="customers-table rm-customers-table">
                                      <thead>
                                        <tr>
                                          <th>Name</th>
                                          <th>Code</th>
                                          <th>Currency</th>
                                          <th>Email</th>
                                          <th>Description</th>
                                          <th>Contact</th>
                                          <th>Status</th>
                                          {(isAdmin || isTL) && <th className="col-actions">Actions</th>}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {rmCustomers.map((c) => (
                                          <React.Fragment key={c.id}>
                                            <tr>
                                              <td className="col-name">{c.name}</td>
                                              <td>{c.code || '—'}</td>
                                              <td>{c.currency_code ? `${c.currency_symbol || ''} (${c.currency_code})` : '—'}</td>
                                              <td>{c.email || '—'}</td>
                                              <td>{c.description ? (c.description.length > 40 ? `${c.description.slice(0, 40)}…` : c.description) : '—'}</td>
                                              <td>{c.contact_details || '—'}</td>
                                              <td>
                                                <span className={c.status === 'Active' ? 'status-badge-active' : 'status-badge-inactive'}>
                                                  {c.status || 'Active'}
                                                </span>
                                              </td>
                                              {(isAdmin || isTL) && (
                                                <td className="col-actions">
                                                  {isAdmin ? (
                                                    <button
                                                      type="button"
                                                      className="btn-secondary btn-row"
                                                      onClick={(e) => { e.stopPropagation(); startEdit(c); }}
                                                    >
                                                      Edit
                                                    </button>
                                                  ) : (
                                                    <button
                                                      type="button"
                                                      className={c.visible_to_rm !== false ? 'btn-secondary btn-row' : 'btn-primary btn-row'}
                                                      onClick={(e) => handleToggleVisibleToRm(e, c)}
                                                      disabled={togglingCustomerId === c.id}
                                                    >
                                                      {togglingCustomerId === c.id ? '…' : c.visible_to_rm !== false ? 'Hide from RM' : 'Show to RM'}
                                                    </button>
                                                  )}
                                                </td>
                                              )}
                                            </tr>
                                            {isAdmin && editing === c.id && (
                                              <tr className="edit-row">
                                                <td colSpan={(isAdmin || isTL) ? 8 : 7}>
                                                  <form onSubmit={handleEditSubmit} onClick={(e) => e.stopPropagation()}>
                                                    <div className="edit-form-grid">
                                                      <div className="form-group">
                                                        <label>Name *</label>
                                                        <input name="name" value={editForm.name} onChange={handleEditChange} required />
                                                      </div>
                                                      {isAdmin && (
                                                        <div className="form-group">
                                                          <label>Assign to RM</label>
                                                          <Select
                                                            name="assigned_rm_id"
                                                            value={editForm.assigned_rm_id}
                                                            onChange={handleEditChange}
                                                            placeholder="— Unassigned —"
                                                          >
                                                            <option value="">— Unassigned —</option>
                                                            {rms.map((r) => (
                                                              <option key={r.id} value={r.id}>{r.name} ({r.email})</option>
                                                            ))}
                                                          </Select>
                                                        </div>
                                                      )}
                                                      <div className="form-group">
                                                        <label>Currency</label>
                                                        <Select
                                                          name="currency_code"
                                                          value={editForm.currency_code || 'INR'}
                                                          onChange={handleEditChange}
                                                        >
                                                          <option value="">— Select currency —</option>
                                                          {CURRENCIES.map((cur) => (
                                                            <option key={cur.code} value={cur.code}>
                                                              {cur.name} ({cur.symbol})
                                                            </option>
                                                          ))}
                                                        </Select>
                                                      </div>
                                                      <div className="form-group">
                                                        <label>Code</label>
                                                        <input name="code" value={editForm.code} onChange={handleEditChange} />
                                                      </div>
                                                      <div className="form-group">
                                                        <label>Email</label>
                                                        <input name="email" type="email" value={editForm.email} onChange={handleEditChange} placeholder="customer@example.com" />
                                                      </div>
                                                      <div className="form-group">
                                                        <label>Status</label>
                                                        <Select name="status" value={editForm.status} onChange={handleEditChange}>
                                                          <option value="Active">Active</option>
                                                          <option value="Inactive">Inactive</option>
                                                        </Select>
                                                      </div>
                                                      <div className="form-group">
                                                        <label>Contact details</label>
                                                        <input name="contact_details" value={editForm.contact_details} onChange={handleEditChange} />
                                                      </div>
                                                    </div>
                                                    <div className="form-group">
                                                      <label>Description</label>
                                                      <textarea
                                                        name="description"
                                                        value={editForm.description}
                                                        onChange={handleEditChange}
                                                        rows={2}
                                                      />
                                                    </div>
                                                    <div className="edit-form-actions">
                                                      <button type="submit" className="btn-primary" disabled={loading}>
                                                        Save
                                                      </button>
                                                      <button type="button" className="btn-secondary" onClick={cancelEdit}>
                                                        Cancel
                                                      </button>
                                                    </div>
                                                  </form>
                                                </td>
                                              </tr>
                                            )}
                                          </React.Fragment>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Customers;
