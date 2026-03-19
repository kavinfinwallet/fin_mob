import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import Select from '../components/Select';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import './Dashboard.css';
import './Admin.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const CreateUser = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [userPagination, setUserPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [userFilters, setUserFilters] = useState({ search: '', role: '', enabled: '' });
  const [userFiltersApplied, setUserFiltersApplied] = useState({ search: '', role: '', enabled: '' });
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', mobile_number: '', role: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    username: '',
    mobile_number: '',
    password: '',
    role: 'RELATIONSHIP_MANAGER'
  });
  const [loading, setLoading] = useState(false);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || user?.is_super_admin;

  const loadRoles = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/auth/roles`);
      setRoles(response.data.roles || []);
    } catch (err) {
      toast(err.response?.data?.message || 'Error loading roles', 'error');
    }
  }, [toast]);

  const loadUsers = useCallback(async (page = 1, limit = 10, filters = { search: '', role: '', enabled: '' }) => {
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (filters.search) params.set('search', filters.search);
      if (filters.role) params.set('role', filters.role);
      if (filters.enabled) params.set('enabled', filters.enabled);
      const res = await axios.get(`${API}/auth/users?${params.toString()}`);
      setUsers(res.data.users || []);
      setUserPagination((prev) => ({
        ...prev,
        page: res.data.pagination?.page ?? page,
        total: res.data.pagination?.total ?? 0,
        totalPages: res.data.pagination?.totalPages ?? 1
      }));
    } catch (err) {
      toast(err.response?.data?.message || 'Error loading users', 'error');
      setUsers([]);
    }
  }, [toast]);

  useEffect(() => {
    if (isAdmin) loadRoles();
  }, [isAdmin, loadRoles]);

  useEffect(() => {
    if (!isAdmin) return;
    loadUsers(userPagination.page, userPagination.limit, userFiltersApplied);
  }, [isAdmin, userPagination.page, userPagination.limit, userFiltersApplied, loadUsers]);

  const applyUserFilters = () => {
    setUserFiltersApplied({ ...userFilters });
    setUserPagination((prev) => ({ ...prev, page: 1 }));
  };

  const toggleEnabled = async (u) => {
    try {
      await axios.patch(`${API}/auth/users/${u.id}`, { enabled: !u.enabled });
      await loadUsers(userPagination.page, userPagination.limit, userFiltersApplied);
      toast(u.enabled ? 'User disabled' : 'User enabled', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Update failed', 'error');
    }
  };

  const openEditModal = (u) => {
    setEditUser(u);
    setEditForm({
      name: u.name || '',
      mobile_number: u.mobile_number || '',
      role: u.role || 'RELATIONSHIP_MANAGER'
    });
  };

  const closeEditModal = () => {
    setEditUser(null);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editUser) return;
    setSavingEdit(true);
    try {
      await axios.patch(`${API}/auth/users/${editUser.id}`, {
        name: editForm.name,
        mobile_number: editForm.mobile_number || '',
        role: editForm.role
      });
      await loadUsers(userPagination.page, userPagination.limit, userFiltersApplied);
      toast('User updated successfully', 'success');
      closeEditModal();
    } catch (err) {
      const msg = err.response?.data?.message || 'Update failed';
      toast(msg, 'error');
      if (msg.includes('Cannot change role') || msg.includes('still linked') || msg.includes('Remove all')) {
        window.alert(msg);
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.role) {
      toast('Name, email and role are required', 'error');
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API}/auth/users`, {
        username: form.username || form.email,
        name: form.name,
        email: form.email,
        mobile_number: form.mobile_number || '',
        password: form.password || undefined,
        role: form.role
      });
      toast('User created successfully', 'success');
      setForm({
        name: '',
        email: '',
        username: '',
        mobile_number: '',
        password: '',
        role: 'RELATIONSHIP_MANAGER'
      });
      setCreateModalOpen(false);
      await loadUsers(userPagination.page, userPagination.limit, userFiltersApplied);
    } catch (err) {
      toast(err.response?.data?.message || 'Error creating user', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="app">
      <Navbar />
      <div className="dashboard-container">
        <div className="dashboard-content">
          <div className="dashboard-card admin-section admin-users-section">
            <div className="admin-users-toolbar">
              <h2 className="admin-users-title">Users</h2>
              <div className="admin-users-toolbar-right">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search name, email, username..."
                  value={userFilters.search}
                  onChange={(e) => setUserFilters((f) => ({ ...f, search: e.target.value }))}
                />
                <select
                  className="filter-select"
                  value={userFilters.role}
                  onChange={(e) => setUserFilters((f) => ({ ...f, role: e.target.value }))}
                >
                  <option value="">All roles</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.name}>{r.name}</option>
                  ))}
                </select>
                <select
                  className="filter-select"
                  value={userFilters.enabled}
                  onChange={(e) => setUserFilters((f) => ({ ...f, enabled: e.target.value }))}
                >
                  <option value="">All status</option>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
                <button type="button" className="btn-secondary admin-btn-apply-filters" onClick={applyUserFilters}>
                  Apply filters
                </button>
                <button
                  type="button"
                  className="btn-primary admin-btn-create-user"
                  onClick={() => setCreateModalOpen(true)}
                >
                  Create user
                </button>
              </div>
            </div>
            <div className="table-scroll-wrap">
              <div className="admin-users-table-wrap admin-users-table-wrap--scrollable">
                <table className="admin-users-table admin-users-table--sticky-head">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Username</th>
                      <th>Mobile</th>
                      <th>Role</th>
                      <th>Enabled</th>
                      <th>Must reset</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)' }}>
                          No users found.
                        </td>
                      </tr>
                    ) : (
                      users.map((u) => (
                        <tr key={u.id}>
                          <td>{u.name}</td>
                          <td>{u.email}</td>
                          <td>{u.username || '—'}</td>
                          <td>{u.mobile_number || '—'}</td>
                          <td>{u.role}</td>
                          <td>{u.enabled ? 'Yes' : 'No'}</td>
                          <td>{u.must_reset_password ? 'Yes' : 'No'}</td>
                          <td>
                            <div className="actions-cell">
                              <button type="button" className="btn-secondary btn-row" onClick={() => openEditModal(u)}>
                                Edit
                              </button>
                              <button
                                type="button"
                                className={u.enabled ? 'btn-secondary btn-row' : 'btn-primary btn-row'}
                                onClick={() => toggleEnabled(u)}
                              >
                                {u.enabled ? 'Disable' : 'Enable'}
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
                Showing {(userPagination.page - 1) * userPagination.limit + 1}–{Math.min(userPagination.page * userPagination.limit, userPagination.total)} of {userPagination.total}
              </span>
              <div className="admin-pagination-controls">
                <button
                  type="button"
                  disabled={userPagination.page <= 1}
                  onClick={() => setUserPagination((p) => ({ ...p, page: p.page - 1 }))}
                >
                  Previous
                </button>
                <span className="admin-pagination-info" style={{ margin: 0 }}>
                  Page {userPagination.page} of {userPagination.totalPages}
                </span>
                <button
                  type="button"
                  disabled={userPagination.page >= userPagination.totalPages}
                  onClick={() => setUserPagination((p) => ({ ...p, page: p.page + 1 }))}
                >
                  Next
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: '0.5rem' }}>
                  Per page
                  <select
                    className="page-size-select"
                    value={userPagination.limit}
                    onChange={(e) => setUserPagination((p) => ({ ...p, limit: Number(e.target.value), page: 1 }))}
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
            <div className="admin-modal-overlay" onClick={() => setCreateModalOpen(false)}>
              <div className="admin-modal admin-modal--wide" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <h3>Create user</h3>
                  <button type="button" className="admin-modal-close" onClick={() => setCreateModalOpen(false)} aria-label="Close">&times;</button>
                </div>
                <form onSubmit={handleCreateSubmit} className="admin-modal-form">
                  <div className="admin-modal-body">
                    <div className="admin-form-grid">
                      <div className="form-group">
                        <label>Name *</label>
                        <input name="name" type="text" value={form.name} onChange={handleChange} required />
                      </div>
                      <div className="form-group">
                        <label>Email *</label>
                        <input name="email" type="email" value={form.email} onChange={handleChange} required />
                      </div>
                      <div className="form-group">
                        <label>Username (optional, defaults to email)</label>
                        <input name="username" type="text" value={form.username} onChange={handleChange} />
                      </div>
                      <div className="form-group">
                        <label>Mobile (optional)</label>
                        <input name="mobile_number" type="text" value={form.mobile_number} onChange={handleChange} />
                      </div>
                      <div className="form-group">
                        <label>Password (optional)</label>
                        <input name="password" type="password" value={form.password} onChange={handleChange} placeholder="Leave empty for default" />
                        <p className="admin-form-hint admin-form-hint-inline">Leave empty = email as default (user must reset on first login).</p>
                      </div>
                      <div className="form-group">
                        <label>Role *</label>
                        <Select name="role" value={form.role} onChange={handleChange} required>
                          {roles.map((r) => (
                            <option key={r.id} value={r.name}>{r.name}</option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  </div>
                  <div className="admin-modal-footer">
                    <div className="admin-modal-footer-actions">
                      <button type="button" className="btn-secondary" onClick={() => setCreateModalOpen(false)}>Cancel</button>
                      <button type="submit" className="btn-primary" disabled={loading}>
                        {loading ? 'Creating...' : 'Create user'}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}

          {editUser && (
            <div className="admin-modal-overlay" onClick={closeEditModal}>
              <div className="admin-modal admin-modal--wide" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <h3>Edit user</h3>
                  <button type="button" className="admin-modal-close" onClick={closeEditModal} aria-label="Close">&times;</button>
                </div>
                <form onSubmit={handleEditSubmit} className="admin-modal-form">
                  <div className="admin-modal-body">
                    <div className="admin-form-grid">
                      <div className="form-group">
                        <label>Name *</label>
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>Email</label>
                        <input type="email" value={editUser.email} readOnly />
                      </div>
                      <div className="form-group">
                        <label>Username</label>
                        <input type="text" value={editUser.username || ''} readOnly />
                      </div>
                      <div className="form-group">
                        <label>Mobile (optional)</label>
                        <input
                          type="text"
                          value={editForm.mobile_number}
                          onChange={(e) => setEditForm((f) => ({ ...f, mobile_number: e.target.value }))}
                        />
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label>Role *</label>
                        <Select
                          name="role"
                          value={editForm.role}
                          onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                        >
                          {roles.map((r) => (
                            <option key={r.id} value={r.name}>{r.name}</option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  </div>
                  <div className="admin-modal-footer">
                    <div className="admin-modal-footer-actions">
                      <button type="button" className="btn-secondary" onClick={closeEditModal}>Cancel</button>
                      <button type="submit" className="btn-primary" disabled={savingEdit}>
                        {savingEdit ? 'Saving...' : 'Save'}
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

export default CreateUser;
