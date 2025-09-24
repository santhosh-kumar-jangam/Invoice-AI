import React, { useState, useEffect } from 'react';
import { Upload, File, Code, X, Loader, FileText, ServerCrash, Trash2, Search, RefreshCw } from 'lucide-react';
import './App.css'; // Import the stylesheet

// --- Configuration ---
const API_BASE_URL = 'http://127.0.0.1:8000';

// --- Helper function ---
const stripExtension = (filename) => {
    return filename.substring(0, filename.lastIndexOf('.')) || filename;
};

// --- Main Component ---
export default function App() {
  const [allInvoices, setAllInvoices] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isJsonView, setIsJsonView] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState(null);
  const [modalCache, setModalCache] = useState({});
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(15);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadInvoices = async () => {
    setLoadingList(true);
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

  useEffect(() => {
    let processedInvoices = [...allInvoices];
    if (searchTerm) {
        processedInvoices = processedInvoices.filter(invoice => invoice.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    processedInvoices.sort((a, b) => {
        switch (sortOrder) {
            case 'oldest': return a.originalDate - b.originalDate;
            case 'name-az': return a.name.localeCompare(b.name);
            case 'name-za': return b.name.localeCompare(a.name);
            default: return b.originalDate - a.originalDate;
        }
    });
    setInvoices(processedInvoices);
  }, [allInvoices, searchTerm, sortOrder]);

  // --- CORRECTED: Modal Data Fetching Effect ---
  // The incorrect cleanup function has been removed from this hook.
  useEffect(() => {
    if (!isModalOpen || !selectedInvoice) return;

    const fetchModalData = async () => {
        setModalError(null);
        const basename = stripExtension(selectedInvoice.name);
        if ((isJsonView && modalCache.jsonData) || (!isJsonView && modalCache.pdfUrl)) {
            setModalContent(isJsonView ? modalCache.jsonData : modalCache.pdfUrl);
            return;
        }
        setModalLoading(true);
        setModalContent(null);
        try {
            if (isJsonView) {
                const response = await fetch(`${API_BASE_URL}/processed-invoices/${basename}`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const data = await response.json();
                setModalContent(data.content);
                setModalCache(prev => ({ ...prev, jsonData: data.content }));
            } else {
                const response = await fetch(`${API_BASE_URL}/invoices/view/${basename}`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const pdfBlob = await response.blob();
                const objectUrl = URL.createObjectURL(pdfBlob);
                setModalContent(objectUrl);
                setModalCache(prev => ({ ...prev, pdfUrl: objectUrl }));
            }
        } catch (error) {
            console.error("Failed to fetch modal content:", error);
            if (isJsonView && error.message.includes('404')) {
                setModalError({ type: 'processing', message: 'This invoice is currently being processed. The JSON will be available once processing is complete.' });
            } else {
                setModalError({ type: 'error', message: 'Could not load the invoice data. Please try again.' });
            }
        } finally {
            setModalLoading(false);
        }
    };
    fetchModalData();
  }, [isModalOpen, isJsonView, selectedInvoice]);

  // --- CORRECTED: Dedicated Cleanup Effect for Modal ---
  // This hook correctly handles revoking the Object URL only when the modal is closed.
  useEffect(() => {
    return () => {
        if (modalCache.pdfUrl) {
            URL.revokeObjectURL(modalCache.pdfUrl);
        }
    };
  }, [isModalOpen]);

  const handleInvoiceClick = (invoice) => {
    if (selectedInvoice?.id !== invoice.id) {
        setModalCache({});
    }
    setSelectedInvoice(invoice);
    setIsJsonView(false);
    setIsModalOpen(true);
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
    } catch (error) {
        console.error("Upload failed:", error);
        alert(`Upload failed: ${error.message}`);
    } finally {
        setUploading(false);
        event.target.value = null;
    }
  };

  const initiateDelete = (e, invoice) => {
    e.stopPropagation();
    setInvoiceToDelete(invoice);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!invoiceToDelete) return;
    setIsDeleting(true);
    try {
        const url = `${API_BASE_URL}/delete-invoice/${encodeURIComponent(invoiceToDelete.name)}`;
        const response = await fetch(url, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: "Failed to delete invoice." }));
            throw new Error(errorData.detail);
        }
        setAllInvoices(prevInvoices => prevInvoices.filter(inv => inv.id !== invoiceToDelete.id));
        if (selectedInvoice?.id === invoiceToDelete.id) {
            setIsModalOpen(false);
        }
    } catch (error) {
        console.error("Delete failed:", error);
        alert(`Delete failed: ${error.message}`);
    } finally {
        setIsDeleting(false); 
        setIsDeleteModalOpen(false);
        setInvoiceToDelete(null);
    }
  };

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const handleSortChange = (e) => {
    setSortOrder(e.target.value);
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(invoices.length / itemsPerPage);
  const paginatedInvoices = invoices.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const JsonSyntaxHighlight = ({ json }) => {
    const jsonString = typeof json !== 'string' ? JSON.stringify(json, undefined, 2) : json;
    const highlightedJson = jsonString.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => { let cls = 'json-number'; if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-string'; else if (/true|false/.test(match)) cls = 'json-boolean'; else if (/null/.test(match)) cls = 'json-null'; return `<span class="${cls}">${match}</span>`; });
    return <pre><code dangerouslySetInnerHTML={{ __html: highlightedJson }} /></pre>;
  };

  const JsonViewer = ({ json }) => (
    <div className="viewer-container"><div className="viewer-header"><Code size={16} /><h4>JSON Structure</h4></div><div className="viewer-content"><JsonSyntaxHighlight json={json} /></div></div>
  );

  const PdfViewer = ({ url }) => (
    <div className="viewer-container"><div className="viewer-header"><FileText size={16} /><h4>Document Preview</h4></div><div className="viewer-content"><iframe src={url} title="PDF Preview" width="100%" height="100%" frameBorder="0" /></div></div>
  );
  
  const ModalPlaceholder = ({ errorInfo }) => {
    if (!errorInfo) { return ( <div className="viewer-container placeholder-container"><Loader size={48} className="loader" /><p style={{ marginTop: '16px', color: 'var(--text-color-light)' }}>Loading...</p></div> ); }
    if (errorInfo.type === 'processing') { return ( <div className="viewer-container placeholder-container"><Loader size={48} className="loader" /><h4 style={{ marginTop: '16px' }}>Processing</h4><p style={{ color: 'var(--text-color-light)', maxWidth: '300px', textAlign: 'center' }}>{errorInfo.message}</p></div> ); }
    return ( <div className="viewer-container placeholder-container"><ServerCrash size={48} opacity={0.3} /><h4 style={{ marginTop: '16px' }}>Error</h4><p style={{ color: 'var(--text-color-light)' }}>{errorInfo.message}</p></div> );
  };

  return (
    <>
      <div className="app-container">
        <header className="app-header"><h1>Invoice Processor</h1></header>
        <div className="invoice-app">
            <aside className="sidebar">
                <label htmlFor="invoice-upload-input" className="upload-btn-label">
                    {uploading ? <Loader size={20} className="loader" /> : <Upload size={20} />}
                    <span>{uploading ? 'Uploading...' : 'Upload Invoice'}</span>
                </label>
                <input type="file" id="invoice-upload-input" onChange={handleFileUpload} disabled={uploading} accept=".pdf,.xml,.json,.png,.jpg,.jpeg" />
            </aside>
            <main className="main-content">
              {loadingList ? ( <div className="loading-container"><Loader size={32} className="loader" /></div> ) : (
                <section className="invoice-list-panel">
                    <div className="list-header">
                        <span>Uploaded Invoices ({invoices.length})</span>
                        <button className="refresh-btn" onClick={refreshStatuses} disabled={isRefreshing || loadingList} title="Refresh statuses">
                            <RefreshCw size={16} className={isRefreshing ? 'loading' : ''} />
                        </button>
                    </div>
                    
                    <div className="list-controls">
                        <div className="search-input-wrapper">
                            <Search size={16} className="search-icon" />
                            <input
                                type="text"
                                placeholder="Search by filename..."
                                className="search-input"
                                value={searchTerm}
                                onChange={handleSearchChange}
                            />
                        </div>
                        <select className="sort-dropdown" value={sortOrder} onChange={handleSortChange}>
                            <option value="newest">Sort by: Newest</option>
                            <option value="oldest">Sort by: Oldest</option>
                            <option value="name-az">Sort by: Name (A-Z)</option>
                            <option value="name-za">Sort by: Name (Z-A)</option>
                        </select>
                    </div>

                    <div className="invoice-list-scroll">
                        {paginatedInvoices.map(invoice => (
                        <div key={invoice.id} className={`invoice-card ${selectedInvoice?.id === invoice.id ? 'selected' : ''}`} onClick={() => handleInvoiceClick(invoice)}>
                            <File size={24} className="file-icon" />
                            <div className="invoice-details">
                                <div className="invoice-name">{invoice.name}</div>
                                <div className="invoice-date">Uploaded: {invoice.uploadDate}</div>
                            </div>
                            {invoice.status && (
                                <span 
                                    className={`status-badge status-${invoice.status} ${isRefreshing ? 'refreshing' : ''}`}
                                >
                                    {invoice.status}
                                </span>
                            )}
                            <button className="delete-btn" title={`Delete ${invoice.name}`} onClick={(e) => initiateDelete(e, invoice)}>
                                <Trash2 size={18} />
                            </button>
                        </div>
                        ))}
                    </div>

                    <div className="pagination-controls">
                        <button className="pagination-btn" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1}>
                            Previous
                        </button>
                        <span className="page-info">
                            Page {currentPage} of {totalPages > 0 ? totalPages : 1}
                        </span>
                        <button className="pagination-btn" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages || totalPages === 0}>
                            Next
                        </button>
                    </div>
                </section>
              )}
            </main>
        </div>
      </div>

      {isModalOpen && selectedInvoice && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h4>{selectedInvoice.name}</h4>
                    <div className="modal-controls">
                        <button className="view-toggle-btn" onClick={() => setIsJsonView(!isJsonView)}>
                            {isJsonView ? <FileText size={16}/> : <Code size={16} />}
                            <span>{isJsonView ? 'View Document' : 'View JSON'}</span>
                        </button>
                        <button className="close-btn" onClick={() => setIsModalOpen(false)}><X size={20}/></button>
                    </div>
                </div>
                <div className="modal-body">
                    {modalLoading || modalError || !modalContent ? (
                        <ModalPlaceholder errorInfo={modalError} />
                    ) : (
                        isJsonView ? <JsonViewer json={modalContent} /> : <PdfViewer url={modalContent} />
                    )}
                </div>
            </div>
        </div>
      )}

      {isDeleteModalOpen && invoiceToDelete && (
            <div className="modal-overlay" onClick={() => !isDeleting && setIsDeleteModalOpen(false)}>
                <div className="delete-modal-content" onClick={e => e.stopPropagation()}>
                    <h4>Confirm Deletion</h4>
                    <p>Are you sure you want to permanently delete <strong>{invoiceToDelete.name}</strong>? This action cannot be undone.</p>
                    <div className="delete-modal-actions">
                        <button 
                            className="btn btn-secondary" 
                            onClick={() => setIsDeleteModalOpen(false)}
                            disabled={isDeleting}
                        >
                            Cancel
                        </button>
                        <button 
                            className="btn btn-danger" 
                            onClick={confirmDelete}
                            disabled={isDeleting}
                        >
                            {isDeleting ? (
                                <>
                                    <Loader size={16} className="loader" />
                                    <span>Deleting...</span>
                                </>
                            ) : (
                                'Delete'
                            )}
                        </button>
                    </div>
                </div>
            </div>
        )}
    </>
  );
}