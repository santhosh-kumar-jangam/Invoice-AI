import React, { useState, useEffect } from 'react';
import { File, Code, X, Loader, FileText, ServerCrash, Trash2, Search, RefreshCw } from 'lucide-react';

const API_BASE_URL = 'http://127.0.0.1:8000';
const stripExtension = (filename) => filename.substring(0, filename.lastIndexOf('.')) || filename;

export default function InvoicesView({ allInvoices, onDataChange, onRefresh, isRefreshing }) {
  const [invoices, setInvoices] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isJsonView, setIsJsonView] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState(null);
  const [modalCache, setModalCache] = useState({});
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false); // For the modal buttons

  // --- NEW: State to track the ID of the invoice being deleted in the list ---
  const [deletingInvoiceId, setDeletingInvoiceId] = useState(null);

  // This effect now depends on the `allInvoices` prop from the parent
  useEffect(() => {
    setInvoices(allInvoices);
  }, [allInvoices]);

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
                setModalError({ type: 'processing', message: 'This invoice is currently being processed.' });
            } else {
                setModalError({ type: 'error', message: 'Could not load the invoice data.' });
            }
        } finally {
            setModalLoading(false);
        }
    };
    fetchModalData();
  }, [isModalOpen, isJsonView, selectedInvoice]);

  useEffect(() => {
    return () => {
        if (modalCache.pdfUrl) {
            URL.revokeObjectURL(modalCache.pdfUrl);
        }
    };
  }, [isModalOpen]);

  const handleInvoiceClick = (invoice) => {
    // Prevent clicking if the card is in the process of being deleted
    if (deletingInvoiceId === invoice.id) return;

    if (selectedInvoice?.id !== invoice.id) {
        setModalCache({});
    }
    setSelectedInvoice(invoice);
    setIsJsonView(false);
    setIsModalOpen(true);
  };

  const initiateDelete = (e, invoice) => {
    e.stopPropagation();
    setInvoiceToDelete(invoice);
    setIsDeleteModalOpen(true);
  };
  
  // --- MODIFIED: confirmDelete now provides immediate visual feedback ---
  const confirmDelete = async () => {
    if (!invoiceToDelete) return;
    
    // This is for the modal buttons
    setIsDeleting(true); 
    
    // Close the confirmation modal IMMEDIATELY
    setIsDeleteModalOpen(false);
    
    // Set the specific invoice ID to trigger the fade-out effect in the list
    setDeletingInvoiceId(invoiceToDelete.id);

    try {
      const url = `${API_BASE_URL}/delete-invoice/${encodeURIComponent(invoiceToDelete.name)}`;
      const response = await fetch(url, { method: 'DELETE' });
      
      // Artificial delay to ensure the user sees the effect
      await new Promise(resolve => setTimeout(resolve, 500));

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Failed to delete." }));
        throw new Error(errorData.detail);
      }

      // Call the parent's full refresh function. This will make the faded item disappear.
      onDataChange();
      
      if (selectedInvoice?.id === invoiceToDelete.id) {
          setIsModalOpen(false);
      }
    } catch (error) {
      console.error("Delete failed:", error);
      alert(`Delete failed: ${error.message}`);
    } finally {
      // Clear all related states
      setIsDeleting(false); 
      setInvoiceToDelete(null);
      setDeletingInvoiceId(null);
    }
  };

  const handleSearchChange = (e) => { setSearchTerm(e.target.value); setCurrentPage(1); };
  const handleSortChange = (e) => { setSortOrder(e.target.value); setCurrentPage(1); };

  const totalPages = Math.ceil(invoices.length / itemsPerPage);
  const paginatedInvoices = invoices.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const JsonSyntaxHighlight = ({ json }) => {
    const jsonString = typeof json !== 'string' ? JSON.stringify(json, undefined, 2) : json;
    const highlightedJson = jsonString.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => { let cls = 'json-number'; if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-string'; else if (/true|false/.test(match)) cls = 'json-boolean'; else if (/null/.test(match)) cls = 'json-null'; return `<span class="${cls}">${match}</span>`; });
    return <pre><code dangerouslySetInnerHTML={{ __html: highlightedJson }} /></pre>;
  };

  const JsonViewer = ({ json }) => ( <div className="viewer-container"><div className="viewer-header"><Code size={16} /><h4>JSON Structure</h4></div><div className="viewer-content"><JsonSyntaxHighlight json={json} /></div></div> );
  const PdfViewer = ({ url }) => ( <div className="viewer-container"><div className="viewer-header"><FileText size={16} /><h4>Document Preview</h4></div><div className="viewer-content"><iframe src={url} title="PDF Preview" width="100%" height="100%" frameBorder="0" /></div></div> );
  const ModalPlaceholder = ({ errorInfo }) => { if (!errorInfo) { return ( <div className="viewer-container placeholder-container"><Loader size={48} className="loader" /><p style={{ marginTop: '16px', color: 'var(--text-color-light)' }}>Loading...</p></div> ); } if (errorInfo.type === 'processing') { return ( <div className="viewer-container placeholder-container"><Loader size={48} className="loader" /><h4 style={{ marginTop: '16px' }}>Processing</h4><p style={{ color: 'var(--text-color-light)', maxWidth: '300px', textAlign: 'center' }}>{errorInfo.message}</p></div> ); } return ( <div className="viewer-container placeholder-container"><ServerCrash size={48} opacity={0.3} /><h4 style={{ marginTop: '16px' }}>Error</h4><p style={{ color: 'var(--text-color-light)' }}>{errorInfo.message}</p></div> ); };
  
  return (
    <>
      <section className="invoice-list-panel">
        <div className="list-header">
            <span>Uploaded Invoices ({invoices.length})</span>
            <button className="refresh-btn" onClick={onRefresh} disabled={isRefreshing} title="Refresh statuses">
                <RefreshCw size={16} className={isRefreshing ? 'loading' : ''} />
            </button>
        </div>
        <div className="list-controls">
            <div className="search-input-wrapper"><Search size={16} className="search-icon" /><input type="text" placeholder="Search by filename..." className="search-input" value={searchTerm} onChange={handleSearchChange} /></div>
            <select className="sort-dropdown" value={sortOrder} onChange={handleSortChange}><option value="newest">Sort by: Newest</option><option value="oldest">Sort by: Oldest</option><option value="name-az">Sort by: Name (A-Z)</option><option value="name-za">Sort by: Name (Z-A)</option></select>
        </div>
        <div className="invoice-list-scroll">
            {paginatedInvoices.map(invoice => {
              // --- NEW: Add a class if this specific invoice is being deleted ---
              const isCardDeleting = deletingInvoiceId === invoice.id;
              const cardClasses = `invoice-card ${selectedInvoice?.id === invoice.id ? 'selected' : ''} ${isCardDeleting ? 'deleting' : ''}`;
              
              return (
                <div key={invoice.id} className={cardClasses} onClick={() => handleInvoiceClick(invoice)}>
                    <File size={24} className="file-icon" />
                    <div className="invoice-details">
                        <div className="invoice-name">{invoice.name}</div>
                        <div className="invoice-date">Uploaded: {invoice.uploadDate}</div>
                    </div>
                    {invoice.status && (<span className={`status-badge status-${invoice.status} ${isRefreshing ? 'refreshing' : ''}`}>{invoice.status}</span>)}
                    <button className="delete-btn" title={`Delete ${invoice.name}`} onClick={(e) => initiateDelete(e, invoice)} disabled={isCardDeleting}>
                        {isCardDeleting ? <Loader size={18} className="loader"/> : <Trash2 size={18} />}
                    </button>
                </div>
              );
            })}
        </div>
        <div className="pagination-controls">
            <button className="pagination-btn" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1}>Previous</button>
            <span className="page-info">Page {currentPage} of {totalPages > 0 ? totalPages : 1}</span>
            <button className="pagination-btn" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages || totalPages === 0}>Next</button>
        </div>
      </section>

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
                        <button className="btn btn-secondary" onClick={() => setIsDeleteModalOpen(false)} disabled={isDeleting}>Cancel</button>
                        <button className="btn btn-danger" onClick={confirmDelete} disabled={isDeleting}>
                            {isDeleting ? (<><Loader size={16} className="loader" /><span>Deleting...</span></>) : ('Delete')}
                        </button>
                    </div>
                </div>
            </div>
        )}
    </>
  );
}