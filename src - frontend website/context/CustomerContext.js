import React, { createContext, useContext, useState, useCallback } from 'react';
import axios from 'axios';

const CustomerContext = createContext();

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export const useCustomer = () => {
  const context = useContext(CustomerContext);
  if (!context) {
    throw new Error('useCustomer must be used within a CustomerProvider');
  }
  return context;
};

export const CustomerProvider = ({ children }) => {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerIdState] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/customers?activeOnly=true`);
      const list = response.data.customers || [];
      setCustomers(list);
      const fromDb = response.data.selectedCustomerId ?? null;
      const validId = fromDb && list.some(c => String(c.id) === String(fromDb)) ? fromDb : null;
      setSelectedCustomerIdState(validId);
    } catch (err) {
      setCustomers([]);
      setSelectedCustomerIdState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const setSelectedCustomerId = useCallback(async (customerId) => {
    const id = customerId === '' || customerId === undefined ? null : customerId;
    setSelectedCustomerIdState(id);
    try {
      await axios.patch(`${API}/customers/selected`, { customerId: id });
    } catch (err) {
      console.warn('Failed to persist selected customer:', err);
    }
  }, []);

  const selectedCustomer = customers.find(c => String(c.id) === String(selectedCustomerId)) || null;

  return (
    <CustomerContext.Provider
      value={{
        customers,
        selectedCustomerId,
        setSelectedCustomerId,
        selectedCustomer,
        fetchCustomers,
        loading
      }}
    >
      {children}
    </CustomerContext.Provider>
  );
};
