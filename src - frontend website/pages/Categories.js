import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import './Dashboard.css';
import './Budget.css';
import './Admin.css';
import './Categories.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const Categories = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [groups, setGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [groupSaving, setGroupSaving] = useState(false);
  const [filterGroupId, setFilterGroupId] = useState('');

  const [form, setForm] = useState({
    id: null,
    name: '',
    group_id: '',
    keywordsText: '',
    category_tag: ''
  });

  const [groupForm, setGroupForm] = useState({
    id: null,
    name: '',
    display_order: ''
  });

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);

  const isRelationshipManager = user?.role === 'RELATIONSHIP_MANAGER';

  const canEdit = !isRelationshipManager;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [groupsRes, categoriesRes] = await Promise.all([
        axios.get(`${API}/categories/groups`),
        axios.get(`${API}/categories`)
      ]);
      setGroups(groupsRes.data.groups || []);
      setCategories(categoriesRes.data.categories || []);
    } catch (err) {
      toast(err.response?.data?.message || 'Error loading categories', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleGroupFormChange = (e) => {
    const { name, value } = e.target;
    setGroupForm((prev) => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setForm({
      id: null,
      name: '',
      group_id: '',
      keywordsText: '',
      category_tag: ''
    });
  };

  const resetGroupForm = () => {
    setGroupForm({
      id: null,
      name: '',
      display_order: ''
    });
  };

  const handleEdit = (cat) => {
    if (!canEdit) return;
    setForm({
      id: cat.id,
      name: cat.name || '',
      group_id: cat.group_id || '',
      keywordsText: Array.isArray(cat.keywords) ? cat.keywords.join(', ') : '',
      category_tag: cat.category_tag || ''
    });
    setCategoryModalOpen(true);
  };

  const openCreateCategoryModal = () => {
    resetForm();
    setCategoryModalOpen(true);
  };

  const handleGroupEdit = (group) => {
    if (!canEdit) return;
    setGroupForm({
      id: group.id,
      name: group.name || '',
      display_order: group.display_order ?? ''
    });
    setGroupModalOpen(true);
  };

  const openCreateGroupModal = () => {
    resetGroupForm();
    setGroupModalOpen(true);
  };

  const handleDelete = async (cat) => {
    if (!canEdit) return;
    if (!window.confirm(`Delete category "${cat.name}"?`)) return;
    try {
      setSaving(true);
      await axios.delete(`${API}/categories/${cat.id}`);
      toast('Category deleted', 'success');
      await loadData();
      if (form.id === cat.id) {
        resetForm();
        setCategoryModalOpen(false);
      }
    } catch (err) {
      toast(err.response?.data?.message || 'Error deleting category', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleGroupDelete = async (group) => {
    if (!canEdit) return;
    if (!window.confirm(`Delete category group "${group.name}"? Categories under this group will move to Others.`)) return;
    try {
      setGroupSaving(true);
      await axios.delete(`${API}/categories/groups/${group.id}`);
      toast('Category group deleted', 'success');
      await loadData();
      if (groupForm.id === group.id) {
        resetGroupForm();
        setGroupModalOpen(false);
      }
    } catch (err) {
      toast(err.response?.data?.message || 'Error deleting category group', 'error');
    } finally {
      setGroupSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canEdit) {
      toast('Relationship Managers cannot modify categories', 'error');
      return;
    }
    if (!form.name.trim()) {
      toast('Category name is required', 'error');
      return;
    }

    const keywords =
      form.keywordsText
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

    const payload = {
      name: form.name.trim(),
      group_id: form.group_id || null,
      keywords,
      category_tag: form.category_tag && form.category_tag.trim() ? form.category_tag.trim() : null
    };

    try {
      setSaving(true);
      if (form.id) {
        await axios.put(`${API}/categories/${form.id}`, payload);
        toast('Category updated', 'success');
      } else {
        await axios.post(`${API}/categories`, payload);
        toast('Category created', 'success');
      }
      await loadData();
      resetForm();
      setCategoryModalOpen(false);
    } catch (err) {
      toast(err.response?.data?.message || 'Error saving category', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleGroupSubmit = async (e) => {
    e.preventDefault();
    if (!canEdit) {
      toast('Relationship Managers cannot modify category groups', 'error');
      return;
    }
    if (!groupForm.name.trim()) {
      toast('Group name is required', 'error');
      return;
    }

    const payload = {
      name: groupForm.name.trim(),
      display_order: groupForm.display_order !== ''
        ? Number(groupForm.display_order)
        : null
    };

    try {
      setGroupSaving(true);
      if (groupForm.id) {
        await axios.put(`${API}/categories/groups/${groupForm.id}`, payload);
        toast('Category group updated', 'success');
      } else {
        await axios.post(`${API}/categories/groups`, payload);
        toast('Category group created', 'success');
      }
      await loadData();
      resetGroupForm();
      setGroupModalOpen(false);
    } catch (err) {
      toast(err.response?.data?.message || 'Error saving category group', 'error');
    } finally {
      setGroupSaving(false);
    }
  };

  const groupedCategories = useMemo(() => {
    const byGroupId = new Map();
    const groupNameById = new Map();
    groups.forEach((g) => {
      byGroupId.set(g.id, []);
      groupNameById.set(g.id, g.name);
    });

    categories.forEach((c) => {
      const targetId = c.group_id || null;
      if (!byGroupId.has(targetId)) {
        byGroupId.set(targetId, []);
      }
      byGroupId.get(targetId).push(c);
    });

    const sections = [];
    for (const [gid, items] of byGroupId.entries()) {
      const name = gid ? groupNameById.get(gid) || 'Others' : 'Others';
      sections.push({
        id: gid,
        name,
        items: items.sort((a, b) => a.name.localeCompare(b.name))
      });
    }
    // Stable sort by group name
    sections.sort((a, b) => a.name.localeCompare(b.name));
    return sections;
  }, [groups, categories]);

  const filteredSections = groupedCategories.map((section) => ({
    ...section,
    items:
      filterGroupId && section.id !== Number(filterGroupId)
        ? []
        : section.items
  }));

  return (
    <div className="app categories-page">
      <Navbar />
      <div className="dashboard-container">
        <div className="dashboard-content">
          <div className="dashboard-card admin-section admin-users-section categories-page-card">
            <div className="admin-users-toolbar">
              <h2 className="admin-users-title">Categories</h2>
              <div className="admin-users-toolbar-right">
                <label htmlFor="categories-filter-group" className="categories-filter-label">Group</label>
                <select
                  id="categories-filter-group"
                  className="filter-select"
                  value={filterGroupId}
                  onChange={(e) => setFilterGroupId(e.target.value)}
                >
                  <option value="">All</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      className="btn-primary admin-btn-create-user"
                      onClick={openCreateGroupModal}
                    >
                      Create group
                    </button>
                    <button
                      type="button"
                      className="btn-primary admin-btn-create-user"
                      onClick={openCreateCategoryModal}
                    >
                      Create category
                    </button>
                  </>
                )}
              </div>
            </div>
            {isRelationshipManager && (
              <p className="categories-rm-notice">
                Relationship Managers can view categories but cannot create or edit them.
              </p>
            )}

            <div className="dashboard-card categories-all-panel">
              <div className="categories-all-header">
                <h3 className="categories-panel-title">All categories</h3>
              </div>

              {loading ? (
                <p className="categories-loading">Loading categories…</p>
              ) : groupedCategories.length === 0 ? (
                <p className="categories-empty">No categories defined yet.</p>
              ) : (
                <div className="categories-list-scroll">
                  {filteredSections.map((section) =>
                    section.items.length === 0 ? null : (
                      <div key={section.id || 'others'} className="categories-group-card">
                        <div className="categories-group-header">
                          <span>{section.name}</span>
                          {canEdit && section.id && (
                            <div className="categories-group-actions">
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => handleGroupEdit({ id: section.id, name: section.name, display_order: (groups.find(g => g.id === section.id) || {}).display_order })}
                                disabled={groupSaving}
                              >
                                Edit group
                              </button>
                              <button
                                type="button"
                                className="btn-secondary categories-btn-delete"
                                onClick={() => {
                                  const g = groups.find(gr => gr.id === section.id);
                                  if (g) handleGroupDelete(g);
                                }}
                                disabled={groupSaving}
                              >
                                Delete group
                              </button>
                            </div>
                          )}
                        </div>
                        <ul className="categories-group-list">
                          {section.items.map((cat) => (
                            <li key={cat.id} className="categories-group-item">
                              <div className="categories-group-item-main">
                                <span className="categories-group-item-name">
                                  {cat.name}
                                  {(cat.category_tag === 'investment' || cat.category_tag === 'emi') && (
                                    <span className={`categories-type-badge categories-type-${cat.category_tag}`}>
                                      {cat.category_tag === 'investment' ? 'Investment' : 'EMI'}
                                    </span>
                                  )}
                                </span>
                                {Array.isArray(cat.keywords) && cat.keywords.length > 0 && (
                                  <div className="categories-keywords">
                                    {cat.keywords.slice(0, 8).map((kw, i) => (
                                      <span key={i} className="categories-keyword-tag" title={kw}>
                                        {kw}
                                      </span>
                                    ))}
                                    {cat.keywords.length > 8 && (
                                      <span className="categories-keyword-tag">+{cat.keywords.length - 8}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              {canEdit && (
                                <div className="categories-group-item-actions">
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => handleEdit(cat)}
                                    disabled={saving}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary categories-btn-delete"
                                    onClick={() => handleDelete(cat)}
                                    disabled={saving}
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            {categoryModalOpen && (
              <div className="admin-modal-overlay" onClick={() => { setCategoryModalOpen(false); resetForm(); }}>
                <div className="admin-modal admin-modal--wide" onClick={(e) => e.stopPropagation()}>
                  <div className="admin-modal-header">
                    <h3>{form.id ? 'Edit category' : 'Create category'}</h3>
                    <button type="button" className="admin-modal-close" onClick={() => { setCategoryModalOpen(false); resetForm(); }} aria-label="Close">&times;</button>
                  </div>
                  <form onSubmit={handleSubmit} className="admin-modal-form">
                    <div className="admin-modal-body">
                      <div className="admin-form-grid">
                        <div className="form-group">
                          <label>Name *</label>
                          <input
                            type="text"
                            name="name"
                            value={form.name}
                            onChange={handleFormChange}
                            disabled={!canEdit || saving}
                            placeholder="e.g. Groceries"
                            required
                          />
                        </div>
                        <div className="form-group">
                          <label>Group</label>
                          <select
                            name="group_id"
                            value={form.group_id}
                            onChange={handleFormChange}
                            disabled={!canEdit || saving}
                          >
                            <option value="">Others</option>
                            {groups.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Category tag</label>
                          <select
                            name="category_tag"
                            value={form.category_tag}
                            onChange={handleFormChange}
                            disabled={!canEdit || saving}
                          >
                            <option value="">None</option>
                            <option value="investment">Investment</option>
                            <option value="emi">EMI</option>
                          </select>
                          <p className="admin-form-hint admin-form-hint-inline">Tag as Investment or EMI for reporting and filters.</p>
                        </div>
                        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                          <label>Keywords (comma separated)</label>
                          <textarea
                            name="keywordsText"
                            rows={3}
                            value={form.keywordsText}
                            onChange={handleFormChange}
                            disabled={!canEdit || saving}
                            placeholder="super market, grocery, food, ..."
                          />
                          <p className="admin-form-hint admin-form-hint-inline">Used by the AI categorizer to match transactions to this category.</p>
                        </div>
                      </div>
                    </div>
                    <div className="admin-modal-footer">
                      <div className="admin-modal-footer-actions">
                        <button type="button" className="btn-secondary" onClick={() => { setCategoryModalOpen(false); resetForm(); }}>Cancel</button>
                        <button type="submit" className="btn-primary admin-btn-create-user" disabled={!canEdit || saving}>
                          {saving ? 'Saving...' : form.id ? 'Save changes' : 'Create category'}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {groupModalOpen && (
              <div className="admin-modal-overlay" onClick={() => { setGroupModalOpen(false); resetGroupForm(); }}>
                <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="admin-modal-header">
                    <h3>{groupForm.id ? 'Edit category group' : 'Create category group'}</h3>
                    <button type="button" className="admin-modal-close" onClick={() => { setGroupModalOpen(false); resetGroupForm(); }} aria-label="Close">&times;</button>
                  </div>
                  <form onSubmit={handleGroupSubmit} className="admin-modal-form">
                    <div className="admin-modal-body">
                      <div className="admin-form-grid">
                        <div className="form-group">
                          <label>Group name *</label>
                          <input
                            type="text"
                            name="name"
                            value={groupForm.name}
                            onChange={handleGroupFormChange}
                            disabled={!canEdit || groupSaving}
                            placeholder="e.g. Essential"
                            required
                          />
                        </div>
                        <div className="form-group">
                          <label>Display order</label>
                          <input
                            type="number"
                            name="display_order"
                            value={groupForm.display_order}
                            onChange={handleGroupFormChange}
                            disabled={!canEdit || groupSaving}
                            placeholder="1, 2, 3..."
                          />
                          <p className="admin-form-hint admin-form-hint-inline">Groups are shown in ascending order; leave blank to keep current.</p>
                        </div>
                      </div>
                    </div>
                    <div className="admin-modal-footer">
                      <div className="admin-modal-footer-actions">
                        <button type="button" className="btn-secondary" onClick={() => { setGroupModalOpen(false); resetGroupForm(); }}>Cancel</button>
                        <button type="submit" className="btn-primary admin-btn-create-user" disabled={!canEdit || groupSaving}>
                          {groupSaving ? 'Saving...' : groupForm.id ? 'Save group' : 'Create group'}
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
    </div>
  );
};

export default Categories;

