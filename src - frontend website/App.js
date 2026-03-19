import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { CustomerProvider } from './context/CustomerContext';
import PrivateRoute from './components/PrivateRoute';
import Toaster from './components/Toaster';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Analytics from './pages/Analytics';
import UploadAnalytics from './pages/UploadAnalytics';
import UploadHistory from './pages/UploadHistory';
import Customers from './pages/Customers';
import CreateCustomer from './pages/CreateCustomer';
import CreateUser from './pages/CreateUser';
import RmTlAssignments from './pages/RmTlAssignments';
import Admin from './pages/Admin';
import Approvals from './pages/Approvals';
import Settings from './pages/Settings';
import CategorizationQueue from './pages/CategorizationQueue';
import Categories from './pages/Categories';
import './App.css';

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <Toaster />
        <AuthProvider>
          <CustomerProvider>
            <Router>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route
                  path="/dashboard"
                  element={
                    <PrivateRoute>
                      <Dashboard />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/transactions"
                  element={
                    <PrivateRoute>
                      <Transactions />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/analytics"
                  element={
                    <PrivateRoute>
                      <Analytics />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/upload-analytics"
                  element={
                    <PrivateRoute>
                      <UploadAnalytics />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/upload-history"
                  element={
                    <PrivateRoute>
                      <UploadHistory />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/categorization-queue"
                  element={
                    <PrivateRoute>
                      <CategorizationQueue />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/categories"
                  element={
                    <PrivateRoute>
                      <Categories />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/customers"
                  element={
                    <PrivateRoute>
                      <Customers />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/customers/create"
                  element={
                    <PrivateRoute>
                      <CreateCustomer />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/create-user"
                  element={
                    <PrivateRoute>
                      <CreateUser />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/assignments"
                  element={
                    <PrivateRoute>
                      <RmTlAssignments />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <PrivateRoute>
                      <Admin />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/approvals"
                  element={
                    <PrivateRoute>
                      <Approvals />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <PrivateRoute>
                      <Settings />
                    </PrivateRoute>
                  }
                />
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Router>
          </CustomerProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;

