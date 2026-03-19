import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useCustomer } from '../context/CustomerContext';
import './RequireCustomerGate.css';

/**
 * For RM and TL: blocks content until a customer is selected from the global dropdown.
 * Renders children when user is Admin/Super Admin or when a customer is selected.
 */
const RequireCustomerGate = ({ children }) => {
  const { user } = useAuth();
  const { selectedCustomerId, selectedCustomer } = useCustomer();

  const isRMorTL = user?.role === 'RELATIONSHIP_MANAGER' || user?.role === 'TEAM_LEAD';
  const noValidCustomer = isRMorTL && (!selectedCustomerId || !selectedCustomer);
  const inactiveOrStale = isRMorTL && selectedCustomerId && !selectedCustomer;

  if (noValidCustomer) {
    return (
      <div className="require-customer-gate">
        <div className="require-customer-card">
          <h2>{inactiveOrStale ? 'Customer no longer available' : 'Select a customer'}</h2>
          <p>
            {inactiveOrStale
              ? <>The selected customer is inactive or no longer available. Please select an active customer from the <strong>Active customer</strong> dropdown above.</>
              : <>Please select a customer from the <strong>Active customer</strong> dropdown above to continue.</>}
          </p>
          <p className="require-customer-hint">
            Only active customers can be used. Your actions (transactions, budget, analytics) will apply to the selected customer.
          </p>
        </div>
      </div>
    );
  }

  return children;
};

export default RequireCustomerGate;
