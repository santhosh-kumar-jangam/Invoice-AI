import React, { useState, useEffect } from 'react';
import { Upload, Home, FileText, Loader, LogOut, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import './App.css';
import InvoicesView from './components/InvoicesView';
import DashboardView from './components/DashboardView';
import ChatWidget from './components/ChatWidget';

const API_BASE_URL = 'http://127.0.0.1:8000';

// --- NEW COMPONENT: Moved into App.js for simplicity, can also be a separate file ---
function UploadProgressModal({ files, errors, onClose }) {
  const allDone = files.every(f => f.status === 'success' || f.status === 'failed');

  return (
    <div className="modal-overlay">
      <div className="progress-modal-content">
        <h4>Uploading Invoices...</h4>
        <div className="upload-progress-list">
          {files.map(file => (
            <div key={file.name}>
              <div className="upload-item">
                <span className="upload-item-name">{file.name}</span>
                <div className="upload-item-status">
                  {file.status === 'pending' && <><Clock size={16} className="status-icon-pending"/><span>Pending</span></>}
                  {file.status === 'uploading' && <><Loader size={16} className="loader"/><span>Uploading...</span></>}
                  {file.status === 'success' && <><CheckCircle size={16} className="status-icon-success"/><span>Uploaded</span></>}
                  {file.status === 'failed' && <><AlertCircle size={16} className="status-icon-failed"/><span>Failed</span></>}
                </div>
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


// --- Login Page Component ---
function LoginPage({ onLogin }) {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      onLogin(email);
    }, 1000);
  };

  return (
    <div className="login-page-container">
      <div className="login-card">
        <h1>Intelligent Invoice Processor</h1>
        <p>Please log in to continue.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="email">Email Address</label>
            <input 
              type="email" 
              id="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required 
              placeholder="e.g., alex@company.com"
            />
          </div>
          <div className="input-group">
            <label htmlFor="password">Password</label>
            <input 
              type="password" 
              id="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required 
              placeholder="Enter your password" 
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={isLoading}>
            {isLoading ? <Loader size={16} className="loader" /> : 'Login'}
          </button>
        </form>
      </div>
      <footer className="login-page-footer">
        © {new Date().getFullYear()} Invoice AI. All Rights Reserved.
      </footer>
    </div>
  );
}

// --- Main App Component ---
function MainApp({ user, onLogout }) {
  const [activeView, setActiveView] = useState('dashboard');
  const [allInvoices, setAllInvoices] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);
  const [uploadErrors, setUploadErrors] = useState({});

  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  const loadInvoices = async () => {
    if (allInvoices.length === 0) {
      setLoadingList(true);
    }
    try {
        const response = await fetch(`${API_BASE_URL}/invoices/`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        const formattedInvoices = data.map(invoice => ({
            id: invoice.filename, name: invoice.filename, status: invoice.status,
            uploadDate: new Date(invoice.last_modified).toLocaleDateString(),
            originalDate: new Date(invoice.last_modified),
        }));
        setAllInvoices(formattedInvoices);
    } catch (error) {
        console.error("Failed to fetch invoices:", error);
        setAllInvoices([]);
    } finally {
        setLoadingList(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, []);

  const refreshStatuses = async () => {
    setIsRefreshing(true);
    try {
        const response = await fetch(`${API_BASE_URL}/invoices/statuses/`);
        if (!response.ok) throw new Error("Failed to fetch statuses");
        const statusUpdates = await response.json();
        const statusMap = Object.fromEntries(statusUpdates.map(item => [item.filename, item.status]));
        setAllInvoices(prevInvoices =>
            prevInvoices.map(invoice => {
                const newStatus = statusMap[invoice.id];
                if (newStatus && newStatus !== invoice.status) {
                    return { ...invoice, status: newStatus };
                }
                return invoice;
            })
        );
    } catch (error) {
        console.error("Failed to refresh statuses:", error);
    } finally {
        setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const initialProgress = Array.from(files).map(file => ({
      name: file.name,
      status: 'pending',
    }));
    setUploadProgress(initialProgress);
    setUploadErrors({});
    setIsUploading(true);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress(prev => prev.map(p => p.name === file.name ? { ...p, status: 'uploading' } : p));
      
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch(`${API_BASE_URL}/upload-invoice/`, {
            method: 'POST',
            body: formData,
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: "Server error" }));
            throw new Error(errorData.detail);
        }
        setUploadProgress(prev => prev.map(p => p.name === file.name ? { ...p, status: 'success' } : p));
      } catch (error) {
        console.error(`Upload failed for ${file.name}:`, error);
        setUploadProgress(prev => prev.map(p => p.name === file.name ? { ...p, status: 'failed' } : p));
        setUploadErrors(prev => ({ ...prev, [file.name]: error.message }));
      }
    }
    await loadInvoices();
    setActiveView('invoices');
    event.target.value = null;
  };

  const closeUploadModal = () => {
    setIsUploading(false);
    setUploadProgress([]);
    setUploadErrors({});
  };
  
  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <div className="app-sidebar-header">Invoice AI</div>
        <nav className="app-nav">
          <a href="#" className={activeView === 'dashboard' ? 'active' : ''} onClick={() => setActiveView('dashboard')}><Home size={20} /><span>Dashboard</span></a>
          <a href="#" className={activeView === 'invoices' ? 'active' : ''} onClick={() => setActiveView('invoices')}><FileText size={20} /><span>Invoices</span></a>
        </nav>
      </aside>

      <div className="app-main-view">
        <header className="app-header">
          <h1>{activeView === 'dashboard' ? 'Dashboard' : 'Invoice Management'}</h1>
          <div className="header-right-controls">
            <label htmlFor="invoice-upload-input-main" className="btn btn-primary">
              <Upload size={16} />
              <span>Upload Invoices</span>
            </label>
            <input 
              type="file" 
              id="invoice-upload-input-main" 
              onChange={handleFileUpload} 
              disabled={isUploading}
              style={{display: 'none'}}
              multiple 
            />
            <div className="user-profile">
              <span>{user.name}</span>
              <button className="logout-btn" onClick={() => setIsLogoutModalOpen(true)} title="Logout">
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>

        <main className="main-content-area">
          {loadingList ? <div className="loading-container"><Loader size={32} className="loader" /></div> : (
            <>
              {activeView === 'dashboard' && <DashboardView invoices={allInvoices} />}
              {activeView === 'invoices' && 
                <InvoicesView 
                  allInvoices={allInvoices} 
                  onDataChange={loadInvoices}
                  isRefreshing={isRefreshing}
                  onRefresh={refreshStatuses}
                />
              }
            </>
          )}
        </main>
      </div>
      
      <ChatWidget user_id={user.email} />

      {isUploading && <UploadProgressModal files={uploadProgress} errors={uploadErrors} onClose={closeUploadModal} />}
      {isLogoutModalOpen && (
        <div className="modal-overlay">
          <div className="logout-modal-content">
            <h4>Confirm Logout</h4>
            <p>Are you sure you want to log out?</p>
            <div className="logout-modal-actions">
              <button className="btn btn-secondary" onClick={() => setIsLogoutModalOpen(false)}>No, stay</button>
              <button className="btn btn-danger" onClick={onLogout}>Yes, log out</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Top-Level Controller ---
export default function App() {
  const [user, setUser] = useState(() => {
    const storedUser = sessionStorage.getItem('user');
    return storedUser ? JSON.parse(storedUser) : null;
  });

  const handleLogin = (email) => {
    const newUser = { name: email.split('@')[0], email: email };
    sessionStorage.setItem('user', JSON.stringify(newUser));
    setUser(newUser);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('user');
    setUser(null);
  };

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <MainApp user={user} onLogout={handleLogout} />;
}