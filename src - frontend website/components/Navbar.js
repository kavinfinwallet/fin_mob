import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import { useAuth } from '../context/AuthContext';
import { useCustomer } from '../context/CustomerContext';
import ThemeToggle from './ThemeToggle';
import './Navbar.css';

const Navbar = () => {
  const { user, logout } = useAuth();
  const { customers, selectedCustomerId, setSelectedCustomerId, fetchCustomers, selectedCustomer } = useCustomer();
  const navigate = useNavigate();
  const appName = process.env.REACT_APP_NAME || 'Finwallet';
  const appNameLines = appName.split(' ');
  const [isBudgetMenuOpen, setIsBudgetMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleLogout = () => {
    setIsUserMenuOpen(false);
    logout();
    navigate('/login');
  };

  const canSeeApprovals = user?.role === 'TEAM_LEAD';

  const canSeeAdmin =
    user?.role === 'ADMIN' ||
    user?.role === 'SUPER_ADMIN';

  const canManageCategories =
    user &&
    user.role !== 'RELATIONSHIP_MANAGER';

  const isRmOrAbove =
    user?.role === 'RELATIONSHIP_MANAGER' ||
    user?.role === 'TEAM_LEAD' ||
    user?.role === 'ADMIN' ||
    user?.role === 'SUPER_ADMIN';

  const rawName = user?.name || user?.username || '';
  const formattedName =
    rawName
      .split(' ')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ') || rawName;

  const initials =
    (formattedName || rawName)
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?';

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <div className="navbar-left">
          <Link to="/dashboard" className="navbar-brand-stack">
            {appNameLines.map((part, idx) => (
              <span key={idx} className="navbar-brand-line">
                {part}
              </span>
            ))}
          </Link>
        </div>

        <div className="navbar-center">
          <div className="navbar-links-group">
            <Link to="/dashboard" className="nav-link">
              Dashboard
            </Link>
            {(user?.role === 'TEAM_LEAD' || user?.role === 'RELATIONSHIP_MANAGER') && (
            <div className="nav-budget-parent">
              <button
                type="button"
                className="nav-link nav-link-budget"
                onClick={() => setIsBudgetMenuOpen((open) => !open)}
              >
                Budget
                <span className={`nav-budget-caret ${isBudgetMenuOpen ? 'open' : ''}`}>▾</span>
              </button>
              {isBudgetMenuOpen && (
                <div className="nav-budget-dropdown">
                  <Link
                    to="/transactions"
                    className="nav-budget-item"
                    onClick={() => setIsBudgetMenuOpen(false)}
                  >
                    Transactions
                  </Link>
                  <Link
                    to="/upload-history"
                    className="nav-budget-item"
                    onClick={() => setIsBudgetMenuOpen(false)}
                  >
                    Budget History
                  </Link>
                  <Link
                    to="/categorization-queue"
                    className="nav-budget-item"
                    onClick={() => setIsBudgetMenuOpen(false)}
                  >
                    Budget Queue
                  </Link>
                  {canManageCategories && (
                    <Link
                      to="/categories"
                      className="nav-budget-item"
                      onClick={() => setIsBudgetMenuOpen(false)}
                    >
                      Categories
                    </Link>
                  )}
                </div>
              )}
            </div>
            )}
          </div>

          {(canSeeApprovals || canSeeAdmin) && (
            <div className="navbar-links-group navbar-links-group-secondary">
              {canSeeApprovals && (
                <Link to="/approvals" className="nav-link">
                  Approvals
                </Link>
              )}
              {canSeeAdmin && (
                <Link to="/admin" className="nav-link">
                  Admin
                </Link>
              )}
            </div>
          )}
        </div>

        <div className="navbar-right">
          {isRmOrAbove && (
            <div className="nav-active-customer">
              <Autocomplete
                className="nav-active-customer-select"
                size="small"
                value={selectedCustomer || null}
                options={customers}
                getOptionLabel={(c) => (c && (c.name || c.email)) || ''}
                isOptionEqualToValue={(a, b) => String(a?.id) === String(b?.id)}
                onChange={(_, newValue) => setSelectedCustomerId(newValue?.id ?? null)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    placeholder="Select customer"
                    variant="outlined"
                  />
                )}
                disableClearable={false}
                popupIcon={null}
              />
            </div>
          )}
          <ThemeToggle />
          <div className="nav-user-wrapper">
            <button
              type="button"
              className="nav-user-avatar"
              onClick={() => setIsUserMenuOpen((open) => !open)}
            >
              <span className="nav-user-initials">{initials}</span>
            </button>
            {isUserMenuOpen && (
              <div className="nav-user-menu">
                <div className="nav-user-menu-header">
                  <div className="nav-user-menu-name">{formattedName}</div>
                  {user?.role && (
                    <div className="nav-user-menu-role">
                      {user.role.replace(/_/g, ' ')}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="nav-user-menu-logout"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;

