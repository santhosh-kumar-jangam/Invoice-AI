import React, { useState } from 'react';
import { MessageSquare, X, Paperclip, Send } from 'lucide-react';

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');

  const handleSend = () => {
    if (!message.trim()) return;
    // In a real app, you would send the message here.
    console.log("Sending message:", message);
    setMessage(''); // Clear the input after sending
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <>
      <button className="chat-fab" onClick={() => setIsOpen(!isOpen)} title="AI Assistant">
        {isOpen ? <X size={28} /> : <MessageSquare size={28} />}
      </button>

      <div className={`chat-window ${isOpen ? 'open' : ''}`}>
        <div className="chat-header">
          <h4>AI Assistant</h4>
          <button className="close-btn" onClick={() => setIsOpen(false)}><X size={20} /></button>
        </div>
        <div className="chat-body">
          <p>Hello! How can I help you with your invoices today?</p>
        </div>
        <div className="chat-input-area">
          <div className="chat-input-wrapper">
            <label htmlFor="chat-file-upload" className="chat-action-btn" title="Attach file">
              <Paperclip size={20} />
            </label>
            <input type="file" id="chat-file-upload" />
            <input 
              type="text" 
              placeholder="Type your message..." 
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={handleKeyPress}
            />
            <button 
              className="chat-action-btn send-btn" 
              title="Send message"
              onClick={handleSend}
              disabled={!message.trim()}
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}