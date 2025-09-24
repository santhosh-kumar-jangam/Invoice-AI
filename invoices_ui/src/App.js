import React, { useState, useEffect } from 'react';
import { Upload, Home, FileText, Loader, LogOut } from 'lucide-react';
import './App.css';
import InvoicesView from './components/InvoicesView';
import DashboardView from './components/DashboardView';
import ChatWidget from './components/ChatWidget';

const API_BASE_URL = 'http://127.0.0.1:8000';

// --- Login Page Component ---
function LoginPage({ onLogin }) {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');

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
            />
          </div>
          <div className="input-group">
            <label htmlFor="password">Password</label>
            <input type="password" id="password" required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={isLoading}>
            {isLoading ? <Loader size={16} className="loader" /> : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

// --- Main App Component ---
function MainApp({ username, onLogout }) {
  const [activeView, setActiveView] = useState('dashboard');
  const [allInvoices, setAllInvoices] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadInvoices = async () => {
    // Only show the big initial loader if the list is empty
    if (allInvoices.length === 0) {
      setLoadingList(true);
    }
    try {
        const response = await fetch(`${API_BASE_URL}/invoices/`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        const formattedInvoices = data.map(invoice => ({
            id: invoice.filename,
            name: invoice.filename,
            status: invoice.status,
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
        const statusMap = Object.fromEntries(
            statusUpdates.map(item => [item.filename, item.status])
        );
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
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
        const response = await fetch(`${API_BASE_URL}/upload-invoice/`, { method: 'POST', body: formData });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: "Upload failed." }));
            throw new Error(errorData.detail);
        }
        await loadInvoices();
        setActiveView('invoices');
    } catch (error) {
        console.error("Upload failed:", error);
        alert(`Upload failed: ${error.message}`);
    } finally {
        setUploading(false);
        event.target.value = null;
    }
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
              {uploading ? <Loader size={16} className="loader" /> : <Upload size={16} />}
              <span>{uploading ? 'Uploading...' : 'Upload Invoice'}</span>
            </label>
            <input type="file" id="invoice-upload-input-main" onChange={handleFileUpload} disabled={uploading} style={{display: 'none'}} />
            <div className="user-profile">
              <span>{username}</span>
              <button className="logout-btn" onClick={onLogout} title="Logout"><LogOut size={18} /></button>
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
      <ChatWidget />
    </div>
  );
}

// --- Top-Level Controller ---
export default function App() {
  const [username, setUsername] = useState(() => sessionStorage.getItem('username') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(!!username);

  const handleLogin = (email) => {
    const extractedUsername = email.split('@')[0];
    sessionStorage.setItem('isLoggedIn', 'true');
    sessionStorage.setItem('username', extractedUsername);
    setUsername(extractedUsername);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('username');
    setUsername('');
    setIsLoggedIn(false);
  };

  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <MainApp username={username} onLogout={handleLogout} />;
}