import React, { useState, useEffect, useRef } from 'react';
// --- CHANGE 1: Import the 'History' icon ---
import { MessageSquare, X, Paperclip, Send, Loader, Trash2, ArrowLeft, Plus, RefreshCw, History as HistoryIcon } from 'lucide-react';

const API_BASE_URL = 'http://127.0.0.1:8000';
const initialMessage = { author: 'ai', text: 'Hello! How can I help you today?' };

export default function ChatWidget({ user_id }) {
  // --- CHANGE 2: Set the widget to be open and in 'chat' view by default ---
  const [isOpen, setIsOpen] = useState(false);
  const [activeView, setActiveView] = useState('chat');
  
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState([initialMessage]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const chatBodyRef = useRef(null);

  // --- API Functions ---
  const fetchSessions = async () => {
    if (!user_id) return;
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/chat/history/${user_id}`);
      if (!response.ok) throw new Error("Failed to fetch sessions");
      const data = await response.json();
      setSessions(data);
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSessionHistory = async (sessionId) => {
    setIsLoading(true);
    setHistory([]);
    try {
      const response = await fetch(`${API_BASE_URL}/chat/history/session/${sessionId}?user_id=${user_id}`);
      if (!response.ok) throw new Error("Failed to fetch session history");
      const data = await response.json();
      const reconstructedHistory = data.messages.map((text, index) => ({
        author: (index === 0 || index % 2 === 0) ? 'ai' : 'user',
        text,
      }));
      setHistory(reconstructedHistory.length > 0 ? reconstructedHistory : [initialMessage]);
      setCurrentSessionId(sessionId);
      setActiveView('chat');
    } catch (error) {
      console.error("Failed to fetch session history:", error);
      setHistory([initialMessage, {author: 'ai', text: 'Could not load conversation.'}]);
    } finally {
      setIsLoading(false);
    }
  };
  
  // --- Effects ---
  // --- CHANGE 3: The useEffect for fetching on open is no longer needed. ---
  // The fetch will now be triggered by the user clicking the history button.

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [history, isSending]);

  // --- Event Handlers ---
  const handleSend = async () => {
    if (!message.trim()) return;
    const userMessage = { author: 'user', text: message };
    setHistory(prev => [...prev, userMessage]);
    setMessage('');
    setIsSending(true);

    try {
        const response = await fetch(`${API_BASE_URL}/chat/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage.text, user_id, session_id: currentSessionId }),
        });
        if (!response.ok) throw new Error("API request failed");
        
        const data = await response.json();
        const wasNewSession = !currentSessionId;
        setCurrentSessionId(data.session_id);
        const aiMessage = { author: 'ai', text: data.reply };
        setHistory(prev => [...prev, aiMessage]);
        
        // If this was a new session, we don't need to auto-fetch the list anymore.
        // The user can view it when they click the history button.
        if (wasNewSession) {
            // Optional: you could still pre-fetch here in the background if you want.
            // fetchSessions(); 
        }
    } catch (error) {
        console.error("Chat API error:", error);
        const errorMessage = { author: 'ai', text: 'Sorry, I am having trouble connecting.' };
        setHistory(prev => [...prev, errorMessage]);
    } finally {
        setIsSending(false);
    }
  };

  const handleNewChat = () => {
    setCurrentSessionId(null);
    setHistory([initialMessage]);
    setActiveView('chat'); // Ensure we are in the chat view for a new chat
  };
  
  // --- CHANGE 4: Create a new handler to show the history list ---
  const handleViewHistory = () => {
    setActiveView('list');
    fetchSessions(); // Fetch sessions when the user wants to see them
  };

  const handleDeleteSession = async (e, sessionIdToDelete) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this conversation?")) {
        try {
            const response = await fetch(`${API_BASE_URL}/chat/history/session/${sessionIdToDelete}?user_id=${user_id}`, { method: 'DELETE' });
            if (!response.ok) throw new Error("Failed to delete session");
            setSessions(prevSessions => prevSessions.filter(session => session.id !== sessionIdToDelete));
        } catch (error) {
            console.error("Failed to delete session:", error);
            alert("Could not delete the conversation. Please try again.");
        }
    }
  };

  const handleClearUiChat = () => {
      setHistory([initialMessage]);
  };
  
  const handleKeyPress = (e) => { if (e.key === 'Enter' && !isSending) handleSend(); };

  return (
    <>
      <button className="chat-fab" onClick={() => setIsOpen(!isOpen)} title="AI Assistant">
        {isOpen ? <X size={28} /> : <MessageSquare size={28} />}
      </button>

      <div className={`chat-window ${isOpen ? 'open' : ''}`}>
        {/* --- CHANGE 5: Updated header logic for new UI flow --- */}
        <div className="chat-header">
          <div className="chat-header-title">
            {/* Show back arrow ONLY when in list view to return to chat */}
            {activeView === 'list' && (
              <button className="chat-action-btn" onClick={() => setActiveView('chat')} title="Back to chat">
                <ArrowLeft size={16}/>
              </button>
            )}
            <h4>{activeView === 'list' ? 'Conversations' : 'AI Assistant'}</h4>
          </div>
          <div className="chat-header-controls">
            {/* Show these controls ONLY when in chat view */}
            {activeView === 'chat' && (
              <>
                <button className="chat-action-btn" onClick={handleClearUiChat} title="Clear current chat view">
                  <RefreshCw size={16} />
                </button>
                <button className="chat-action-btn" onClick={handleViewHistory} title="View conversations">
                  <HistoryIcon size={16} />
                </button>
              </>
            )}
            <button className="chat-action-btn" onClick={handleNewChat} title="New chat">
              <Plus size={18} />
            </button>
          </div>
        </div>
        
        <div className="chat-body" ref={chatBodyRef}>
          {isLoading && <div className="loading-container"><Loader size={24} className="loader"/></div>}
          
          {activeView === 'list' && !isLoading && (
            <div className="session-list">
              {sessions.length > 0 ? sessions.map(session => (
                <div key={session.id} className="session-item" onClick={() => fetchSessionHistory(session.id)}>
                  <div className="session-item-details">
                    <div className="session-item-summary">{session.last_message}</div>
                    <div className="session-item-date">{new Date(session.last_updated).toLocaleString()}</div>
                  </div>
                  <button className="session-delete-btn" onClick={(e) => handleDeleteSession(e, session.id)} title="Delete conversation">
                    <Trash2 size={16} />
                  </button>
                </div>
              )) : <div className="empty-list-message">No past conversations.</div>}
            </div>
          )}
          
          {activeView === 'chat' && (
            <>
              {history.map((msg, index) => (
                <div key={index} className={`chat-message ${msg.author}`}><p>{msg.text}</p></div>
              ))}
              {isSending && <div className="chat-message ai"><p><Loader size={16} className="loader" /></p></div>}
            </>
          )}
        </div>
        
        {activeView === 'chat' && (
          <div className="chat-input-area">
            <div className="chat-input-wrapper">
              <label htmlFor="chat-file-upload" className="chat-action-btn" title="Attach file"><Paperclip size={20} /></label>
              <input type="file" id="chat-file-upload" style={{ display: 'none' }} />
              <input type="text" placeholder="Type your message..." value={message} onChange={(e) => setMessage(e.target.value)} onKeyPress={handleKeyPress} disabled={isSending}/>
              <button className="chat-action-btn send-btn" title="Send message" onClick={handleSend} disabled={!message.trim() || isSending}><Send size={20} /></button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}