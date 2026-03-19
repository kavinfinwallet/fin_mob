import React, { useEffect } from 'react';
import { useToast } from '../context/ToastContext';
import './Toaster.css';

const AUTO_DISMISS_MS = 5000;

const Toast = ({ id, message, type, onDismiss }) => {
  useEffect(() => {
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [id, onDismiss]);

  return (
    <div
      className={`toast toast-${type}`}
      role="alert"
      onClick={() => onDismiss()}
    >
      <span className="toast-icon">
        {type === 'success' && '✓'}
        {type === 'error' && '✕'}
        {type === 'warning' && '!'}
        {type === 'info' && 'ℹ'}
      </span>
      <span className="toast-message">{message}</span>
      <button type="button" className="toast-close" aria-label="Close" onClick={(e) => { e.stopPropagation(); onDismiss(); }}>
        ×
      </button>
    </div>
  );
};

const Toaster = () => {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          id={t.id}
          message={t.message}
          type={t.type}
          onDismiss={() => removeToast(t.id)}
        />
      ))}
    </div>
  );
};

export default Toaster;
