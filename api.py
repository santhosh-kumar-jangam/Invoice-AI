from fastapi import FastAPI, File, UploadFile, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import storage
from google.cloud import firestore
from google.api_core import exceptions
from google.adk.runners import Runner
from google.adk.sessions import DatabaseSessionService, Session
from google.genai.types import Content, Part
from chatassistant.agent import chat_agent
from pydantic import BaseModel, Field
import io, mimetypes,json,os,datetime
from fastapi.responses import StreamingResponse
from typing import List,Dict,Any, Optional
from dotenv import load_dotenv
load_dotenv()

class InvoiceStatus(BaseModel):
    filename: str
    status: str
    last_modified: datetime.datetime

class InvoiceStatusUpdate(BaseModel):
    filename: str
    status: str

class UploadResponse(BaseModel):
    status: str
    gcs_uri: str
    filename: str

class FileViewUrl(BaseModel):
    filename: str
    url: str
    expires_at: datetime.datetime

class ProcessedInvoiceContent(BaseModel):
    filename: str
    content: Dict[str, Any]

class SourceInvoice(BaseModel):
    filename: str
    size_in_bytes: int
    last_modified: datetime.datetime
    gcs_uri: str

class DeleteResponse(BaseModel):
    status: str
    message: str

class ChatRequest(BaseModel):
    message: str
    user_id: str
    session_id: Optional[str] = Field(
        None,
        description="The existing session ID to continue a conversation. If null, a new session will be created."
    )

class ChatResponse(BaseModel):
    reply: str
    session_id: str

class SessionSummary(BaseModel):
    id: str
    last_message: str
    last_updated: datetime.datetime

class SessionHistory(BaseModel):
    id: str
    messages: list[str]

# --- FastAPI App ---
app = FastAPI(
    title="Invoice Processing API",
    description="API to upload invoices and list processed results.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- GCS Client Dependency ---
def get_gcs_client():
    try:
        return storage.Client.from_service_account_json(os.getenv("gcp_credentials_path"))
    except FileNotFoundError:
        raise HTTPException(
            status_code=500,
            detail=f"GCP credentials file not found at path: {os.getenv('gcp_credentials_path')}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create GCS client: {e}")
    
# --- Firestore Client Dependency ---
def get_firestore_client():
    """
    Dependency function to create and return a Firestore client.
    
    It uses the same service account credentials as the GCS client.
    """
    gcp_credentials_path = os.getenv("gcp_credentials_path")
    try:
        # The client will automatically use the project ID from the credentials file.
        db = firestore.Client.from_service_account_json(gcp_credentials_path)
        return db
    except FileNotFoundError:
        raise HTTPException(
            status_code=500,
            detail=f"GCP credentials file not found at path: {gcp_credentials_path}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create Firestore client: {e}")

# --- API Endpoints ---
@app.get("/", tags=["Health Check"])
async def read_root():
    return {"status": "API is running"}

@app.post("/upload-invoice", response_model=UploadResponse, tags=["Invoices"])
async def upload_invoice(
    file: UploadFile,
    storage_client: storage.Client = Depends(get_gcs_client),
    db: firestore.Client = Depends(get_firestore_client)
):
    """
    Handles uploading a single invoice file, saving it to GCS and creating
    a corresponding status record in Firestore.
    """
    source_bucket_name = os.getenv("SOURCE_BUCKET")
    
    try:
        # 1. Upload to GCS
        bucket = storage_client.bucket(source_bucket_name)
        if bucket.blob(file.filename).exists():
            raise ValueError(f"File '{file.filename}' already exists.")
            
        blob = bucket.blob(file.filename)
        blob.upload_from_file(file.file)
        gcs_uri = f"gs://{source_bucket_name}/{file.filename}"

        # 2. Create status record in Firestore
        try:
            invoice_ref = db.collection("invoices").document(file.filename)
            invoice_ref.set({
                "filename": file.filename,
                "status": "UPLOADED",
                "created_at": datetime.datetime.now(datetime.timezone.utc),
                "last_modified": datetime.datetime.now(datetime.timezone.utc),
                "gcs_source_uri": gcs_uri
            })
        except Exception as db_e:
            blob.delete() # Rollback GCS upload if DB write fails
            raise db_e

        return {"status": "success", "gcs_uri": gcs_uri, "filename": file.filename}

    except Exception as e:
        print(f"Failed to process file {file.filename}: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    
@app.get("/invoices/", response_model=List[InvoiceStatus], tags=["Invoices"])
async def list_invoices_with_status(
    db: firestore.Client = Depends(get_firestore_client)
):
    """
    Lists all invoices and their current status from the database.
    """
    invoices = []
    try:
        # Conceptual code for Firestore
        invoice_docs = db.collection("invoices").stream()
        for doc in invoice_docs:
            data = doc.to_dict()
            invoices.append(
                InvoiceStatus(
                    filename=data.get("filename"),
                    status=data.get("status"),
                    last_modified=data.get("last_modified")
                )
            )
        # Sort by date before returning
        invoices.sort(key=lambda x: x.last_modified, reverse=True)
        return invoices
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list invoices from database: {e}")
    
@app.get("/invoices/statuses/", response_model=List[InvoiceStatusUpdate], tags=["Invoices"])
async def get_all_invoice_statuses(
    db: firestore.Client = Depends(get_firestore_client)
):
    """
    Returns a lightweight list of all invoices with their current status.
    Designed for efficient polling/refreshing from the UI.
    """
    statuses = []
    try:
        # This query is very fast as it only gets two fields
        invoice_docs = db.collection("invoices").select(["filename", "status"]).stream()
        for doc in invoice_docs:
            data = doc.to_dict()
            statuses.append(
                InvoiceStatusUpdate(
                    filename=data.get("filename"),
                    status=data.get("status")
                )
            )
        return statuses
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch statuses: {e}")
    
@app.get("/processed-invoices/", response_model=List[ProcessedInvoiceContent], tags=["Invoices"])
async def list_processed_invoices_content(
    storage_client: storage.Client = Depends(get_gcs_client)
):
    target_bucket_name = os.getenv("TARGET_BUCKET")
    processed_invoices = []
    try:
        blobs = storage_client.list_blobs(target_bucket_name)
        for blob in blobs:
            if blob.name.endswith(".json"):
                try:
                    json_string = blob.download_as_string()
                    content_dict = json.loads(json_string)
                    
                    # FIX 4: USE THE CORRECT MODEL `ProcessedInvoiceContent` HERE
                    processed_invoices.append(
                        ProcessedInvoiceContent(
                            filename=blob.name,
                            content=content_dict
                        )
                    )
                except json.JSONDecodeError:
                    print(f"Warning: Could not decode JSON from file '{blob.name}'. Skipping.")
                except Exception as e:
                    # The error you saw was being caught here
                    print(f"Warning: Failed to process file '{blob.name}'. Error: {e}. Skipping.")

        return processed_invoices
    except exceptions.NotFound:
        raise HTTPException(status_code=404, detail=f"Destination bucket '{target_bucket_name}' not found.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list files with content: {e}")
    
@app.get("/processed-invoices/{filename}", response_model=ProcessedInvoiceContent, tags=["Invoices"])
async def get_single_invoice_content(
    filename: str,
    storage_client: storage.Client = Depends(get_gcs_client)
):
    """
    Gets the content of a single processed invoice JSON file by its filename.
    """
    target_bucket_name = os.getenv("TARGET_BUCKET")
    filename=filename+'.json'
    try:
        bucket = storage_client.bucket(target_bucket_name)
        blob = bucket.blob(filename)

        # Check if the file actually exists in the bucket
        if not blob.exists():
            raise HTTPException(
                status_code=404,
                detail=f"File '{filename}' not found in bucket '{target_bucket_name}'."
            )

        # Download and parse the JSON content
        json_string = blob.download_as_string()
        content_dict = json.loads(json_string)

        return ProcessedInvoiceContent(filename=filename, content=content_dict)

    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to parse JSON content from file '{filename}'. The file may be corrupt."
        )
    except exceptions.NotFound:
        # This is a fallback, but blob.exists() is the primary check
        raise HTTPException(
            status_code=404,
            detail=f"Destination bucket '{target_bucket_name}' not found."
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Invoice is under processing")

@app.get("/invoices/view/{filename}", tags=["Invoices"])
async def get_invoice_file(
    filename: str,
    storage_client: storage.Client = Depends(get_gcs_client)
):
    """
    Downloads a raw invoice file from the source bucket and streams it directly
    to the client.
    """
    source_bucket_name = os.getenv("SOURCE_BUCKET")
    # You might not want to hardcode the '.pdf' extension if you support other types
    filename = filename + '.pdf' 
    
    try:
        bucket = storage_client.bucket(source_bucket_name)
        blob = bucket.blob(filename) # Use the filename as provided

        if not blob.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Invoice file '{filename}' not found in source bucket '{source_bucket_name}'."
            )

        # Download the file's content into an in-memory bytes buffer
        file_bytes = blob.download_as_bytes()
        file_stream = io.BytesIO(file_bytes)

        # Guess the MIME type of the file based on its extension (e.g., 'application/pdf')
        # This is crucial for the browser to know how to render the file.
        content_type, _ = mimetypes.guess_type(filename)
        if content_type is None:
            content_type = "application/octet-stream" # Default if type can't be guessed

        # Use StreamingResponse to send the file back to the user
        # The 'Content-Disposition' header tells the browser how to handle the file.
        # 'inline' tries to display it in the browser. 'attachment' would force a download.
        return StreamingResponse(
            file_stream,
            media_type=content_type,
            headers={"Content-Disposition": f"inline; filename=\"{filename}\""}
        )

    except exceptions.NotFound:
        raise HTTPException(status_code=404, detail=f"Source bucket '{source_bucket_name}' not found.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {e}")
    
@app.delete("/delete-invoice/{filename}", tags=["Invoices"])
async def delete_invoice(
    filename: str,
    storage_client: storage.Client = Depends(get_gcs_client),
    db: firestore.Client = Depends(get_firestore_client)
):
    """
    Deletes an invoice from the source bucket, the processed bucket,
    and its corresponding record from Firestore.
    """
    source_bucket_name = os.getenv("SOURCE_BUCKET")
    target_bucket_name = os.getenv("TARGET_BUCKET")
    
    deleted_from_source = False
    deleted_from_target = False
    deleted_from_firestore = False

    try:
        # --- 1. Delete from the source GCS bucket (original file) ---
        source_bucket = storage_client.bucket(source_bucket_name)
        source_blob = source_bucket.blob(filename)
        if source_blob.exists():
            source_blob.delete()
            deleted_from_source = True

        # --- 2. Delete from the target GCS bucket (processed JSON) ---
        json_filename = os.path.splitext(filename)[0] + ".json"
        target_bucket = storage_client.bucket(target_bucket_name)
        target_blob = target_bucket.blob(json_filename)
        if target_blob.exists():
            target_blob.delete()
            deleted_from_target = True

        # --- 3. Delete the record from Firestore ---
        doc_ref = db.collection("invoices").document(filename)
        if doc_ref.get().exists:
            doc_ref.delete()
            deleted_from_firestore = True

        # If the file wasn't found anywhere, return a 404
        if not any([deleted_from_source, deleted_from_target, deleted_from_firestore]):
            raise HTTPException(
                status_code=404, 
                detail=f"File '{filename}' not found in GCS or Firestore."
            )

        return {
            "status": "deleted", 
            "filename": filename,
            "cleaned_source_gcs": deleted_from_source,
            "cleaned_target_gcs": deleted_from_target,
            "cleaned_firestore": deleted_from_firestore
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {e}")

# ----- CHAT ENDPOINT -----
try:
    CHAT_SESSIONS_DB_PATH = os.getenv("CHAT_SESSIONS_DB_PATH")
    if not CHAT_SESSIONS_DB_PATH:
        raise ValueError("CHAT_SESSIONS_DB_PATH environment variable not set.")

    db_url = f"sqlite:///{CHAT_SESSIONS_DB_PATH}"
    print(f"Initializing Session Service with database at: {db_url}")
    session_service = DatabaseSessionService(db_url=db_url)
    print("Session Service ready.")
except Exception as e:
    print(f"FATAL: Could not initialize ADK Session Service. Error: {e}")
    session_service = None

if not session_service:
    raise HTTPException(status_code=503, detail="Chat service is not available.")
    
@app.post("/chat/", response_model=ChatResponse, tags=["Chat"])
async def handle_chat_message(request: ChatRequest):
    """
    Handles a user's chat message, routes it to the chat_agent,
    manages the conversation session, and returns the agent's final response.
    """

    try:
        if request.session_id:
            # Continue an existing conversation
            session = await session_service.get_session(session_id=request.session_id, app_name="invoice_chat", user_id=request.user_id)
            if not session:
                # If the client sends an invalid/expired session ID, create a new one
                print(f"Warning: Session '{request.session_id}' not found. Creating a new session.")
                session = await session_service.create_session(app_name="invoice_chat", user_id=request.user_id)
        else:
            # Start a new conversation
            session = await session_service.create_session(app_name="invoice_chat", user_id=request.user_id)

        print(f"Using Session ID: {session.id} for User: {request.user_id}")

        # 2. INITIALIZE THE AGENT RUNNER
        agent_runner = Runner(agent=chat_agent, app_name="invoice_chat", session_service=session_service)

        # 3. RUN THE AGENT
        message = Content(parts=[Part(text=request.message)],role="user")
        
        final_reply = "Sorry, I encountered an issue and could not get a response."

        events = agent_runner.run_async(
            session_id=session.id,
            user_id=request.user_id,
            new_message=message,
        )

        # 4. PROCESS THE RESPONSE STREAM
        async for event in events:
            print(f"Event from: {event.author}, Type: {type(event.content)}")
            if event.is_final_response() and event.content and event.content.parts and event.content.parts[0]:
                final_reply = event.content.parts[0].text
        
        await agent_runner.close()
        print(f"Agent Final Reply: {final_reply}")

        # 5. RETURN THE RESPONSE
        return ChatResponse(reply=final_reply, session_id=session.id)

    except Exception as e:
        print(f"An error occurred during chat processing: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="An internal error occurred in the chat service.")
    
@app.get("/chat/history/{user_id}", response_model=list[SessionSummary], tags=["Chat"])
async def get_session_history_for_user(user_id: str):
    """
    Retrieves a list of all past conversation sessions for a given user.
    """
    if not session_service:
        raise HTTPException(status_code=503, detail="Chat service not available.")
    try:
        sessions = await session_service.list_sessions(app_name="invoice_chat", user_id=user_id)
        sessions=dict(sessions)
        summaries = []
        lastmessage = ""
        for session in sessions["sessions"]:
            session = await session_service.get_session(session_id=session.id, app_name="invoice_chat", user_id=user_id)
            events=session.events

            last_event=events[-1]
            last_but_event=events[-2]
            lastmessage=last_event.content.parts[0].text if last_event.content.role=="model" else last_but_event.content.parts[0].text
                    
            summaries.append(SessionSummary(
                id=session.id,
                last_message=lastmessage,
                last_updated=session.last_update_time
            ))
        
        # Sort by most recently modified
        summaries.sort(key=lambda s: s.last_updated, reverse=True)
        return summaries
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list sessions: {e}")

@app.get("/chat/history/session/{session_id}", response_model=SessionHistory, tags=["Chat"])
async def get_messages_for_session(session_id: str, user_id: str):
    """
    Retrieves the full message history for a single conversation session.
    """
    if not session_service:
        raise HTTPException(status_code=503, detail="Chat service not available.")
    try:
        # Step 1: First, get the session to confirm it exists and belongs to the user.
        session = await session_service.get_session(session_id=session_id, app_name="invoice_chat", user_id=user_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found.")
        
        session = await session_service.get_session(session_id=session_id, app_name="invoice_chat", user_id=user_id)
        events=session.events

        messages = []
        # The history is in the `events` list, which contains Content objects
        for event in events:
            # print(event)
            
            if event.content.role=="user":
                if event.content.parts[0].text is not None:
                    messages.append(event.content.parts[0].text)
            if event.is_final_response() :
                if event.content.parts[0].text is not None:
                    messages.append(event.content.parts[0].text)

        return SessionHistory(id=session.id, messages=messages)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get session messages: {e}")

@app.delete("/chat/history/session/{session_id}", status_code=204, tags=["Chat"])
async def delete_chat_session(session_id: str, user_id: str): # user_id for security
    """
    Deletes a single conversation session.
    """
    if not session_service:
        raise HTTPException(status_code=503, detail="Chat service not available.")
    try:
        await session_service.delete_session(session_id=session_id, app_name="invoice_chat", user_id=user_id)
        return
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete session: {e}")