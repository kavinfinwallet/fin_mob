import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Navbar from '../components/Navbar';
import './Dashboard.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const Settings = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const mustReset = location.state?.mustReset || user?.must_reset_password;

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const hasShownWarning = useRef(false);

  useEffect(() => {
    if (mustReset && !hasShownWarning.current) {
      toast('You must change your password before continuing.', 'warning');
      hasShownWarning.current = true;
    }
  }, [mustReset, toast]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      toast('New password and confirmation do not match.', 'error');
      return;
    }
    if (form.newPassword.length < 6) {
      toast('New password must be at least 6 characters.', 'error');
      return;
    }

    setLoading(true);
    try {
      await axios.post(`${API}/auth/change-password`, {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword
      });
      toast('Password updated successfully.', 'success');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      if (mustReset) {
        setTimeout(() => navigate('/dashboard'), 1500);
      }
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to update password.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <Navbar />
      <div className="dashboard-container">
        <div className="dashboard-content">
          <h1>Settings</h1>
          <p className="welcome-text">Change your password</p>

          <div className="dashboard-card" style={{ maxWidth: 420 }}>
            <h2>Change Password</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="currentPassword">Current password</label>
                <input
                  type="password"
                  id="currentPassword"
                  name="currentPassword"
                  value={form.currentPassword}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="newPassword">New password</label>
                <input
                  type="password"
                  id="newPassword"
                  name="newPassword"
                  value={form.newPassword}
                  onChange={handleChange}
                  required
                  minLength={6}
                />
              </div>
              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm new password</label>
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  required
                />
              </div>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Updating...' : 'Update password'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
