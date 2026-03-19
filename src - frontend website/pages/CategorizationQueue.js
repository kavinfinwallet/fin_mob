import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useToast } from '../context/ToastContext';
import { useCustomer } from '../context/CustomerContext';
import './CategorizationQueue.css';

const CategorizationQueue = () => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();
  const navigate = useNavigate();
  const previousStatusesRef = useRef({});

  const apiBase = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
  const { selectedCustomerId, selectedCustomer } = useCustomer();

  const formatDateTime = (value) => {
    if (!value) return '-';
    try {
      return new Date(value).toLocaleString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(value);
    }
  };

  const loadJobs = async () => {
    if (selectedCustomerId == null || selectedCustomerId === '') {
      setJobs([]);
      setLoading(false);
      return;
    }
    try {
      const params = new URLSearchParams();
      params.set('customer_id', String(selectedCustomerId));
      const response = await axios.get(`${apiBase}/transactions/categorize/jobs?${params.toString()}`);
      const newJobs = response.data.jobs || [];

      // Detect status changes to completed / failed for toast alerts
      const prevStatuses = previousStatusesRef.current || {};
      const nextStatuses = {};

      newJobs.forEach((job) => {
        const prevStatus = prevStatuses[job.id];
        nextStatuses[job.id] = job.status;

        // Show toast when a job transitions into a terminal state
        if (prevStatus && prevStatus !== job.status) {
          if (job.status === 'completed') {
            toast(
              `Categorization completed for ${job.file_name || 'upload #' + job.upload_id}`,
              'success'
            );
          } else if (job.status === 'failed') {
            const reason = job.error_message ? `: ${job.error_message}` : '';
            toast(
              `Categorization failed for ${job.file_name || 'upload #' + job.upload_id}${reason}`,
              'error'
            );
          }
        }
      });

      previousStatusesRef.current = nextStatuses;
      setJobs(newJobs);
    } catch (err) {
      if (err.response?.status === 400 && err.response?.data?.message?.toLowerCase().includes('customer_id')) {
        setJobs([]);
      } else {
        console.error('Error loading categorization jobs:', err);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomerId]);

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'queued':
        return 'job-status queued';
      case 'processing':
        return 'job-status processing';
      case 'completed':
        return 'job-status completed';
      case 'failed':
        return 'job-status failed';
      default:
        return 'job-status queued';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'queued':
        return 'Queued';
      case 'processing':
        return 'Processing';
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      default:
        return status || 'Queued';
    }
  };

  const filteredJobs = jobs.filter((job) => {
    const matchesStatus =
      statusFilter === 'all' ? true : job.status === statusFilter;

    if (!matchesStatus) return false;

    if (!searchTerm.trim()) return true;

    const query = searchTerm.toLowerCase();
    const fileName = (job.file_name || '').toLowerCase();
    const uploadId = String(job.upload_id || '').toLowerCase();

    return fileName.includes(query) || uploadId.includes(query);
  });

  const handleRetry = async (job) => {
    try {
      await axios.post(`${apiBase}/transactions/categorize/jobs/${job.id}/retry`);
      toast('Categorization restarted for this job', 'success');
      loadJobs();
    } catch (err) {
      toast(
        err.response?.data?.message || 'Error restarting categorization',
        'error'
      );
    }
  };

  const handleGoToReview = async (job) => {
    try {
      const response = await axios.get(
        `${apiBase}/transactions/uploads/${job.upload_id}/resume`
      );

      const {
        uploadId,
        fileName,
        columnMapping,
        transactions,
        currentStep,
        status,
      } = response.data;

      // If upload is fully completed, go to upload analytics; otherwise go to review
      if (job.upload_status === 'completed' || status === 'completed') {
        navigate('/upload-analytics', {
          state: {
            uploadId,
            fileName,
            columnMapping,
            transactions: (transactions || []).map((t) => ({
              ...t,
              category_name: t.category_name || t.categoryName || 'Uncategorized',
              category_id: t.category_id ?? t.categoryId,
            })),
            currentStep,
            uploadStatus: status,
            keyObservation: response.data.key_observation || '',
            rejectionComment: response.data.rejection_comment || '',
            currentUser: null,
            customerName: selectedCustomer ? (selectedCustomer.name || selectedCustomer.email) : null,
          },
        });
      } else {
        navigate('/transactions', {
          state: {
            resume: true,
            uploadId,
            fileName,
            columnMapping,
            transactions,
            currentStep,
            status,
          },
        });
      }
    } catch (err) {
      toast(
        err.response?.data?.message || 'Error opening review for this upload',
        'error'
      );
    }
  };

  const noCustomerSelected = selectedCustomerId == null || selectedCustomerId === '';

  return (
    <div className="app">
      <Navbar />
      <div className="queue-container">
        {noCustomerSelected && (
          <div className="queue-empty queue-select-customer">
            <h2>Select a customer</h2>
            <p>Choose a customer from the navbar to view the Budget Queue for that customer.</p>
          </div>
        )}

        {!noCustomerSelected && loading && jobs.length === 0 && (
          <div className="queue-loading">Loading jobs...</div>
        )}

        {!noCustomerSelected && !loading && jobs.length === 0 && (
          <div className="queue-empty">
            {selectedCustomer && (
              <p className="queue-customer-label queue-customer-label-inline">
                Showing queue for: <strong>{selectedCustomer.name}</strong>
              </p>
            )}
            <h2>No Budget Queue jobs yet</h2>
            <p>Start by uploading a PDF from the Transactions page for this customer.</p>
            <button
              type="button"
              className="primary-button"
              onClick={() => navigate('/transactions')}
            >
              Go to Transactions
            </button>
          </div>
        )}

        {!noCustomerSelected && jobs.length > 0 && (
          <>
            <h1 className="queue-page-heading">Budget Queue</h1>
            {selectedCustomer && (
              <p className="queue-customer-label">
                Showing queue for: <strong>{selectedCustomer.name}</strong>
              </p>
            )}
            <div className="queue-toolbar">
              <div className="queue-toolbar-left">
                <input
                  type="text"
                  className="queue-search-input"
                  placeholder="Search by file name or upload ID"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="queue-toolbar-right">
                <select
                  className="queue-filter-select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="queued">Queued</option>
                  <option value="processing">Processing</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
                <button
                  type="button"
                  className="btn-secondary queue-refresh-button"
                  onClick={loadJobs}
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="jobs-table-wrapper">
              <table className="jobs-table">
                <thead>
                  <tr>
                    <th>File / Upload</th>
                    <th>Upload ID</th>
                    <th>Transactions</th>
                    <th>Status</th>
                    <th>Queued</th>
                    <th>Started</th>
                    <th>Completed</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.length === 0 && (
                    <tr className="jobs-table-empty">
                      <td colSpan="8">No jobs match your current filters.</td>
                    </tr>
                  )}
                  {filteredJobs.map((job) => (
                    <tr key={job.id}>
                      <td className="jobs-table-primary">
                        <div className="jobs-table-file">
                          <div className="jobs-table-file-name">
                            {job.file_name || `Upload #${job.upload_id}`}
                          </div>
                          {job.error_message && (
                            <div className="jobs-table-error" title={job.error_message}>
                              <strong>Error:</strong> {job.error_message}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>{job.upload_id}</td>
                      <td>{job.total_transactions || 0}</td>
                      <td>
                        <span className={getStatusBadgeClass(job.status)}>
                          {getStatusLabel(job.status)}
                        </span>
                      </td>
                      <td>{formatDateTime(job.created_at)}</td>
                      <td>{formatDateTime(job.started_at)}</td>
                      <td>{formatDateTime(job.completed_at)}</td>
                      <td className="jobs-table-actions">
                        {job.status === 'completed' && (
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => handleGoToReview(job)}
                          >
                            {job.upload_status === 'completed' ? 'View analytics' : 'Go to Review'}
                          </button>
                        )}
                        {job.status === 'failed' && (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => handleRetry(job)}
                          >
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CategorizationQueue;

