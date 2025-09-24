import React from 'react';
import { File, Loader, CheckCircle, AlertCircle } from 'lucide-react';

// Receives all invoices to calculate stats
export default function DashboardView({ invoices }) {
  const total = invoices.length;
  const processing = invoices.filter(inv => inv.status === 'PROCESSING').length;
  const completed = invoices.filter(inv => inv.status === 'COMPLETED').length;
  const failed = invoices.filter(inv => inv.status === 'FAILED').length;
  const recentInvoices = invoices.slice(0, 4);

  return (
    <div>
      <h2>Dashboard</h2>
      <div className="stat-card-grid">
        <div className="stat-card">
          <div className="label">Total Invoices</div>
          <div className="value">{total}</div>
        </div>
        <div className="stat-card">
          <div className="label">Processing</div>
          <div className="value">{processing}</div>
        </div>
        <div className="stat-card">
          <div className="label">Completed</div>
          <div className="value">{completed}</div>
        </div>
        <div className="stat-card">
          <div className="label">Failed</div>
          <div className="value">{failed}</div>
        </div>
      </div>
      
      <h3>Recent Invoices</h3>
      <div className="recent-invoices-list">
        {recentInvoices.length > 0 ? recentInvoices.map(invoice => (
          <div key={invoice.id} className="invoice-card">
            <File size={24} className="file-icon" />
            <div className="invoice-details">
              <div className="invoice-name">{invoice.name}</div>
              <div className="invoice-date">Uploaded: {invoice.uploadDate}</div>
            </div>
            {invoice.status && <span className={`status-badge status-${invoice.status}`}>{invoice.status}</span>}
          </div>
        )) : <p>No recent invoices found.</p>}
      </div>
    </div>
  );
}