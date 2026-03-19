import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useCustomer } from '../context/CustomerContext';
import Navbar from '../components/Navbar';
import RequireCustomerGate from '../components/RequireCustomerGate';
import './Dashboard.css';

const apiBase = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const Dashboard = () => {
  const { user } = useAuth();
  const { selectedCustomerId } = useCustomer();
  const [waitingForApprovalCount, setWaitingForApprovalCount] = useState(null);

  useEffect(() => {
    if (user?.role !== 'TEAM_LEAD') return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (selectedCustomerId != null && selectedCustomerId !== '') {
          params.set('customer_id', String(selectedCustomerId));
        }
        const url = params.toString()
          ? `${apiBase}/transactions/approvals/waiting-count?${params.toString()}`
          : `${apiBase}/transactions/approvals/waiting-count`;
        const res = await axios.get(url, { signal: controller.signal });
        setWaitingForApprovalCount(res.data.count ?? 0);
      } catch (err) {
        if (axios.isCancel(err) || err.name === 'AbortError') return;
        setWaitingForApprovalCount(0);
      }
    };
    load();
    return () => controller.abort();
  }, [user?.role, selectedCustomerId]);

  return (
    <div className="app">
      <Navbar />
      <RequireCustomerGate>
        <div className="dashboard-container">
          <div className="dashboard-content">
            <h1>Welcome to {process.env.REACT_APP_NAME || 'Finwallet'}</h1>
            <p className="welcome-text">
              Hello, {user?.name || user?.username}!{' '}
              {user?.role && `(Role: ${user.role.replace(/_/g, ' ')})`}
            </p>

            <div className="dashboard-cards">
              {(user?.role === 'TEAM_LEAD' || user?.role === 'RELATIONSHIP_MANAGER') && (
                <>
                  <Link to="/transactions" className="dashboard-card">
                    <h2>Budget</h2>
                    <p>Upload and categorize bank statements</p>
                  </Link>
                  <Link to="/upload-history" className="dashboard-card">
                    <h2>Budget History</h2>
                    <p>View and resume your budget uploads</p>
                  </Link>
                  <Link to="/categorization-queue" className="dashboard-card">
                    <h2>Budget Queue</h2>
                    <p>Track background AI budget queue jobs</p>
                  </Link>
                </>
              )}

              {(user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN') && (
                <Link to="/customers/create" className="dashboard-card">
                  <h2>Create customer</h2>
                  <p>Add a new customer and assign to an RM</p>
                </Link>
              )}

              {(user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN') && (
                <Link to="/create-user" className="dashboard-card">
                  <h2>Create user</h2>
                  <p>Add Team Leads and Relationship Managers</p>
                </Link>
              )}

              {(user?.role === 'SUPER_ADMIN' ||
                user?.role === 'ADMIN' ||
                user?.role === 'TEAM_LEAD') && (
                <Link to="/customers" className="dashboard-card">
                  <h2>RM&apos;s Details</h2>
                  <p>View RMs and their allocated customers</p>
                </Link>
              )}

              {user?.role === 'TEAM_LEAD' && (
                <Link to="/approvals" className="dashboard-card">
                  <h2>Approvals</h2>
                  <p>Approve uploads and budget submissions</p>
                  {waitingForApprovalCount != null && waitingForApprovalCount > 0 && (
                    <span className="dashboard-card-badge dashboard-card-badge-approvals">
                      {waitingForApprovalCount} waiting for approval
                    </span>
                  )}
                </Link>
              )}

              {(user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN') && (
                <Link to="/assignments" className="dashboard-card">
                  <h2>Assignments</h2>
                  <p>Assign customers to RMs and RMs to Team Leads</p>
                </Link>
              )}

              {(user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN') && (
                <Link to="/admin" className="dashboard-card">
                  <h2>Admin</h2>
                  <p>Users, RM–TL allocations, and usage</p>
                </Link>
              )}

              {(user?.role === 'SUPER_ADMIN' ||
                user?.role === 'ADMIN' ||
                user?.role === 'TEAM_LEAD') && (
                <Link to="/categories" className="dashboard-card">
                  <h2>Categories</h2>
                  <p>Manage category groups and categories</p>
                </Link>
              )}
            </div>
          </div>
        </div>
      </RequireCustomerGate>
    </div>
  );
};

export default Dashboard;

