import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import './Dashboard.css';
import './Budget.css';
import './Admin.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const Admin = () => {
  const { user } = useAuth();
  const [usage, setUsage] = useState({ dailyLimit: 0, used: 0, remaining: 0 });
  const [usageDetail, setUsageDetail] = useState({ byUser: [], recentLog: [] });
  const [logs, setLogs] = useState([]);
  const [, setRoles] = useState([]);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || user?.is_super_admin;
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    try {
      const [usageRes, detailRes, logsRes, rolesRes] = await Promise.all([
        axios.get(`${API}/usage/gemini`).catch(() => ({ data: {} })),
        axios.get(`${API}/usage/gemini/detail?allUsers=1&days=7`).catch(() => ({ data: { byUser: [], recentLog: [] } })),
        axios.get(`${API}/auth/user-logs`),
        axios.get(`${API}/auth/roles`)
      ]);
      setUsage(usageRes.data || {});
      setUsageDetail(detailRes.data || { byUser: [], recentLog: [] });
      setLogs(logsRes.data.logs || []);
      setRoles(rolesRes.data.roles || []);
    } catch (err) {
      toast(err.response?.data?.message || 'Error loading admin data', 'error');
    }
  }, [toast]);

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin, loadData]);

  if (!isAdmin) {
    return (
      <div className="app">
        <Navbar />
        <div className="dashboard-container">
          <div className="dashboard-content">
            <h1>Admin</h1>
            <p>You do not have permission to view this page.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Navbar />
      <div className="dashboard-container">
        <div className="dashboard-content">
          <h1>Admin</h1>
          <p className="admin-capabilities-summary" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
            System governance and team management: add Team Leads and RMs, enable or disable users, allocate or switch RMs between TLs, and view all users and their status below.
          </p>

          <div className="dashboard-card" style={{ marginBottom: '1.5rem' }}>
            <h2>Gemini usage</h2>
            <p><strong>Used today:</strong> Input {usage.usedInput ?? 0} · Output {usage.usedOutput ?? 0} · Total {usage.used ?? 0}</p>
            <p><strong>Remaining today:</strong> {usage.remaining ?? 0} / {usage.dailyLimit ?? 0}</p>
          </div>

          <div className="dashboard-card" style={{ marginBottom: '1.5rem' }}>
            <h2>Gemini usage detail (last 7 days)</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Who used, for what feature, and how many times.
            </p>
            {usageDetail.byUser?.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                      <th style={{ padding: '0.5rem' }}>User</th>
                      <th style={{ padding: '0.5rem' }}>Feature</th>
                      <th style={{ padding: '0.5rem' }}>Calls</th>
                      <th style={{ padding: '0.5rem' }}>Input</th>
                      <th style={{ padding: '0.5rem' }}>Output</th>
                      <th style={{ padding: '0.5rem' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageDetail.byUser.flatMap((u) =>
                      (u.byFeature || []).map((f, i) => (
                        <tr key={`${u.userId}-${f.feature}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '0.5rem' }}>
                            {i === 0 ? `${u.name || u.username || ''} (${u.email || u.userId})` : ''}
                          </td>
                          <td style={{ padding: '0.5rem' }}>{f.feature}</td>
                          <td style={{ padding: '0.5rem' }}>{f.callCount}</td>
                          <td style={{ padding: '0.5rem' }}>{(f.inputTokens ?? 0).toLocaleString()}</td>
                          <td style={{ padding: '0.5rem' }}>{(f.outputTokens ?? 0).toLocaleString()}</td>
                          <td style={{ padding: '0.5rem' }}>{(f.totalTokens ?? 0).toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {usageDetail.recentLog?.length > 0 && (
                  <>
                    <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>Recent log (last 100)</h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                          <th style={{ padding: '0.4rem' }}>Time</th>
                          <th style={{ padding: '0.4rem' }}>User</th>
                          <th style={{ padding: '0.4rem' }}>Feature</th>
                          <th style={{ padding: '0.4rem' }}>Input</th>
                          <th style={{ padding: '0.4rem' }}>Output</th>
                          <th style={{ padding: '0.4rem' }}>Total</th>
                          <th style={{ padding: '0.4rem' }}>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageDetail.recentLog.slice(0, 20).map((r) => (
                          <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.4rem' }}>{new Date(r.usedAt).toLocaleString()}</td>
                            <td style={{ padding: '0.4rem' }}>{r.email || r.username}</td>
                            <td style={{ padding: '0.4rem' }}>{r.feature}</td>
                            <td style={{ padding: '0.4rem' }}>{r.inputTokens != null ? r.inputTokens.toLocaleString() : '—'}</td>
                            <td style={{ padding: '0.4rem' }}>{r.outputTokens != null ? r.outputTokens.toLocaleString() : '—'}</td>
                            <td style={{ padding: '0.4rem' }}>{r.estimatedTokensUsed?.toLocaleString() ?? '—'}</td>
                            <td style={{ padding: '0.4rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.details || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            ) : (
              <p style={{ color: 'var(--text-secondary)' }}>No Gemini usage recorded yet.</p>
            )}
          </div>

          <div className="dashboard-card admin-section" style={{ marginBottom: '1.5rem' }}>
            <h2>Users</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Manage users, create new accounts, and edit or enable/disable existing ones.
            </p>
            <Link to="/create-user" className="admin-btn-create-user" style={{ display: 'block', textDecoration: 'none', color: 'inherit', textAlign: 'center' }}>
              Open Users page
            </Link>
          </div>

          <div className="dashboard-card admin-section" style={{ marginBottom: '1.5rem' }}>
            <h2>Assignments</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Assign customers to RMs and RMs to Team Leads.
            </p>
            <Link to="/assignments" className="admin-btn-create-user" style={{ display: 'block', textDecoration: 'none', color: 'inherit', textAlign: 'center' }}>
              Open Assignments
            </Link>
          </div>

          <div className="dashboard-card">
            <h2>User log</h2>
            {logs.length === 0 ? (
              <p>No log entries yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {logs.slice(0, 100).map((log) => (
                  <li key={log.id} style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--border-color)' }}>
                    [{new Date(log.created_at).toLocaleString()}] {log.name || log.username || log.user_id} – {log.action} {log.details && `(${log.details})`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Admin;
