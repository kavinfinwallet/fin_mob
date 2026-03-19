import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ThemeToggle from '../components/ThemeToggle';
import './Auth.css';

const APP_NAME = process.env.REACT_APP_NAME || 'Finwallet';

const Login = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const result = await login(formData.email, formData.password);

    if (result.success) {
      if (result.user?.must_reset_password) {
        navigate('/settings', { state: { mustReset: true } });
      } else {
        navigate('/dashboard');
      }
    } else {
      toast(result.message || 'Login failed', 'error');
    }

    setLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="theme-toggle-wrapper">
        <ThemeToggle />
      </div>
      <div className="auth-card">
        <h1>{APP_NAME}</h1>
        <p className="auth-subtitle">Sign in to your account</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              autoComplete="current-password"
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="auth-link">
          No account? Contact your administrator for access.
        </p>
      </div>
    </div>
  );
};

export default Login;
