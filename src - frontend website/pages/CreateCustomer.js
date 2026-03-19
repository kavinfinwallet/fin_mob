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
import './Admin.css';
import './Customers.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const CreateCustomer = () => {
  const { user } = useAuth();
  const { fetchCustomers: refreshGlobalCustomers } = useCustomer();
  const [rms, setRms] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 10 });
  const [form, setForm] = useState({
    name: '',
    code: '',
    email: '',
    description: '',
    contact_details: '',
    assigned_rm_id: '',
    status: 'Active',
    currency_code: 'INR',
    currency_symbol: '₹'
  });
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState(null);
  const { toast } = useToast();

  const isEditMode = editingCustomerId != null;

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || user?.is_super_admin;

  const loadRms = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/customers/assignable-rms`);
      setRms(response.data.rms || []);
    } catch (err) {
      toast(err.response?.data?.message || 'Error loading RMs', 'error');
    }
  }, [toast]);

  const loadCustomers = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/customers`);
      setCustomers(response.data.customers || []);
    } catch (err) {
      toast(err.response?.data?.message || 'Error loading customers', 'error');
      setCustomers([]);
    }
  }, [toast]);

  const toggleCustomerStatus = async (customer) => {
    const newStatus = customer.status === 'Active' ? 'Inactive' : 'Active';
    try {
      await axios.patch(`${API}/customers/${customer.id}`, { status: newStatus });
      await loadCustomers();
      refreshGlobalCustomers();
      toast(`Customer ${newStatus === 'Active' ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Update failed', 'error');
    }
  };

  const openCreateModal = () => {
    setEditingCustomerId(null);
    setForm({
      name: '',
      code: '',
      email: '',
      description: '',
      contact_details: '',
      assigned_rm_id: '',
      status: 'Active',
      currency_code: 'INR',
      currency_symbol: '₹'
    });
    setCreateModalOpen(true);
  };

  const openEditModal = (customer) => {
    setEditingCustomerId(customer.id);
    setForm({
      name: customer.name || '',
      code: customer.code || '',
      email: customer.email || '',
      description: customer.description || '',
      contact_details: customer.contact_details || '',
      assigned_rm_id: customer.assigned_rm_id ? String(customer.assigned_rm_id) : '',
      status: customer.status || 'Active',
      currency_code: customer.currency_code || 'INR',
      currency_symbol: customer.currency_symbol != null && customer.currency_symbol !== '' ? customer.currency_symbol : '₹'
    });
    setCreateModalOpen(true);
  };

  const closeModal = () => {
    setCreateModalOpen(false);
    setEditingCustomerId(null);
    setForm({
      name: '',
      code: '',
      email: '',
      description: '',
      contact_details: '',
      assigned_rm_id: '',
      status: 'Active',
      currency_code: 'INR',
      currency_symbol: '₹'
    });
  };

  useEffect(() => {
    if (isAdmin) {
      loadRms();
      loadCustomers();
    }
  }, [isAdmin, loadRms, loadCustomers]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.code && c.code.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.rm_name && c.rm_name.toLowerCase().includes(q)) ||
        (c.rm_email && c.rm_email.toLowerCase().includes(q)) ||
        (c.contact_details && c.contact_details.toLowerCase().includes(q))
    );
  }, [customers, customerSearch]);

  if (!user) return null;
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'currency_code') {
        const cur = CURRENCIES.find((c) => c.code === value);
        if (cur) next.currency_symbol = cur.symbol;
      }
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name) {
      toast('Customer name is required', 'error');
      return;
    }
    if (!form.assigned_rm_id) {
      toast('Please assign the customer to an RM', 'error');
      return;
    }
    if (!form.currency_code) {
      toast('Please select a currency', 'error');
      return;
    }
    setLoading(true);
    try {
      if (isEditMode) {
        await axios.patch(`${API}/customers/${editingCustomerId}`, {
          name: form.name,
          code: form.code || null,
          email: form.email || null,
          description: form.description || null,
          contact_details: form.contact_details || null,
          status: form.status || 'Active',
          assigned_rm_id: form.assigned_rm_id ? parseInt(form.assigned_rm_id, 10) : null,
          currency_code: form.currency_code || 'INR',
          currency_symbol: form.currency_symbol != null && form.currency_symbol !== '' ? form.currency_symbol : '₹'
        });
        refreshGlobalCustomers();
        await loadCustomers();
        toast('Customer updated successfully', 'success');
      } else {
        await axios.post(`${API}/customers`, {
          ...form,
          assigned_rm_id: parseInt(form.assigned_rm_id, 10),
          currency_code: form.currency_code || 'INR',
          currency_symbol: form.currency_symbol != null && form.currency_symbol !== '' ? form.currency_symbol : '₹'
        });
        refreshGlobalCustomers();
        await loadCustomers();
        toast('Customer created successfully', 'success');
        setPagination((p) => ({ ...p, page: 1 }));
      }
      closeModal();
    } catch (err) {
      toast(err.response?.data?.message || (isEditMode ? 'Error updating customer' : 'Error creating customer'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app customers-page create-customer-page">
      <Navbar />
      <div className="dashboard-container">
        <div className="dashboard-content">
          <div className="dashboard-card admin-section admin-users-section create-customer-page-card">
            <div className="admin-users-toolbar">
              <h2 className="admin-users-title">Customers</h2>
              <div className="admin-users-toolbar-right">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search by name, code, email, RM, or contact..."
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setPagination((p) => ({ ...p, page: 1 }));
                  }}
                />
                <button
                  type="button"
                  className="btn-primary admin-btn-create-user"
                  onClick={openCreateModal}
                >
                  Create customer
                </button>
              </div>
            </div>
            <div className="table-scroll-wrap">
              <div className="admin-users-table-wrap admin-users-table-wrap--scrollable">
                <table className="admin-users-table admin-users-table--sticky-head">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Code</th>
                      <th>Email</th>
                      <th>Assigned RM</th>
                      <th>Status</th>
                      <th>Contact</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const start = (pagination.page - 1) * pagination.limit;
                      const pageCustomers = filteredCustomers.slice(start, start + pagination.limit);
                      return pageCustomers.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)' }}>
                            No customers yet. Click &quot;Create customer&quot; to add one.
                          </td>
                        </tr>
                      ) : (
                        pageCustomers.map((c) => (
                          <tr key={c.id}>
                            <td className="col-name">{c.name}</td>
                            <td>{c.code || '—'}</td>
                            <td>{c.email || '—'}</td>
                            <td>{c.rm_name ? `${c.rm_name} (${c.rm_email || ''})` : '—'}</td>
                            <td>
                              <span className={c.status === 'Active' ? 'status-badge-active' : 'status-badge-inactive'}>
                                {c.status || 'Active'}
                              </span>
                            </td>
                            <td>{c.contact_details || '—'}</td>
                            <td>
                              <div className="actions-cell">
                                <button
                                  type="button"
                                  className="btn-secondary btn-row"
                                  onClick={() => openEditModal(c)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className={c.status === 'Active' ? 'btn-secondary btn-row' : 'btn-primary btn-row'}
                                  onClick={() => toggleCustomerStatus(c)}
                                >
                                  {c.status === 'Active' ? 'Disable' : 'Enable'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      );
                    })()}
                  </tbody>
                </table>
              </div>
              <div className="admin-pagination admin-pagination--sticky">
                <span className="admin-pagination-info">
                  {filteredCustomers.length === 0
                    ? 'Showing 0 of 0'
                    : `Showing ${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, filteredCustomers.length)} of ${filteredCustomers.length}`}
                  {customerSearch.trim() && customers.length > 0 && ` (filtered from ${customers.length})`}
                </span>
                <div className="admin-pagination-controls">
                  <button
                    type="button"
                    disabled={pagination.page <= 1}
                    onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
                  >
                    Previous
                  </button>
                  <span className="admin-pagination-info" style={{ margin: 0 }}>
                    Page {pagination.page} of {Math.max(1, Math.ceil(filteredCustomers.length / pagination.limit))}
                  </span>
                  <button
                    type="button"
                    disabled={pagination.page >= Math.ceil(filteredCustomers.length / pagination.limit)}
                    onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
                  >
                    Next
                  </button>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: '0.5rem' }}>
                    Per page
                    <select
                      className="page-size-select"
                      value={pagination.limit}
                      onChange={(e) => setPagination((p) => ({ ...p, limit: Number(e.target.value), page: 1 }))}
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {createModalOpen && (
            <div className="admin-modal-overlay" onClick={closeModal}>
              <div className="admin-modal admin-modal--wide" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <h3>{isEditMode ? 'Edit customer' : 'Create customer'}</h3>
                  <button type="button" className="admin-modal-close" onClick={closeModal} aria-label="Close">&times;</button>
                </div>
                <form onSubmit={handleSubmit} className="admin-modal-form">
                  <div className="admin-modal-body">
                    <div className="admin-form-grid">
                      <div className="form-group">
                        <label>Name *</label>
                        <input name="name" type="text" value={form.name} onChange={handleChange} required />
                      </div>
                      <div className="form-group">
                        <label>Assign to RM *</label>
                        <Select
                          name="assigned_rm_id"
                          value={form.assigned_rm_id}
                          onChange={handleChange}
                          required
                        >
                          <option value="">— Select RM —</option>
                          {rms.map((r) => (
                            <option key={r.id} value={r.id}>{r.name} ({r.email})</option>
                          ))}
                        </Select>
                        {rms.length === 0 && (
                          <p className="admin-form-hint admin-form-hint-inline">Create RM users in Admin first.</p>
                        )}
                      </div>
                      <div className="form-group">
                        <label>Currency *</label>
                        <Select
                          name="currency_code"
                          value={form.currency_code || 'INR'}
                          onChange={handleChange}
                          required
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
                        <label>Code (optional)</label>
                        <input name="code" type="text" value={form.code} onChange={handleChange} />
                      </div>
                      <div className="form-group">
                        <label>Email (optional)</label>
                        <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="customer@example.com" />
                      </div>
                      <div className="form-group">
                        <label>Contact details (optional)</label>
                        <input name="contact_details" type="text" value={form.contact_details} onChange={handleChange} />
                      </div>
                      {isEditMode && (
                        <div className="form-group">
                          <label>Status</label>
                          <Select name="status" value={form.status || 'Active'} onChange={handleChange}>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                          </Select>
                        </div>
                      )}
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label>Description (optional)</label>
                        <textarea
                          name="description"
                          value={form.description}
                          onChange={handleChange}
                          rows={2}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="admin-modal-footer">
                    <div className="admin-modal-footer-actions">
                      <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                      <button type="submit" className="btn-primary admin-btn-create-user" disabled={loading}>
                        {loading ? (isEditMode ? 'Saving...' : 'Creating...') : (isEditMode ? 'Save changes' : 'Create customer')}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreateCustomer;
