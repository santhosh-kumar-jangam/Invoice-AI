import React from 'react';
import { Loader, CheckCircle, AlertCircle, Clock } from 'lucide-react';

export default function UploadProgressModal({ files, errors, onClose }) {
  const allDone = files.every(f => f.status === 'success' || f.status === 'failed');

  return (
    <div className="modal-overlay">
      <div className="progress-modal-content">
        <h4>Uploading Invoices...</h4>
        <div className="upload-progress-list">
          {files.map(file => (
            <div key={file.name} className="upload-item">
              <span className="upload-item-name">{file.name}</span>
              <div className="upload-item-status">
                {file.status === 'pending' && <><Clock size={16} className="status-icon-pending"/><span>Pending</span></>}
                {file.status === 'uploading' && <><Loader size={16} className="loader"/><span>Uploading...</span></>}
                {file.status === 'success' && <><CheckCircle size={16} className="status-icon-success"/><span>Uploaded</span></>}
                {file.status === 'failed' && <><AlertCircle size={16} className="status-icon-failed"/><span>Failed</span></>}
              </div>
              {file.status === 'failed' && errors[file.name] && (
                <div className="upload-error-message">{errors[file.name]}</div>
              )}
            </div>
          ))}
        </div>
        {allDone && (
          <div className="progress-modal-footer">
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}