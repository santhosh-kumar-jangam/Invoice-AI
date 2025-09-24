from fastapi import FastAPI, File, UploadFile, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import storage
from google.cloud import firestore
from google.api_core import exceptions
from pydantic import BaseModel
import io, mimetypes,json,os,datetime
from fastapi.responses import StreamingResponse
from typing import List,Dict,Any
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

@app.post("/upload-invoice/", response_model=UploadResponse, tags=["Invoices"])
async def upload_invoice(
    file: UploadFile = File(...),
    storage_client: storage.Client = Depends(get_gcs_client),
    db: firestore.Client = Depends(get_firestore_client)
):
    source_bucket_name = os.getenv("SOURCE_BUCKET")
    
    # Upload to GCS
    try:
        bucket = storage_client.bucket(source_bucket_name)
        blob = bucket.blob(file.filename)
        blob.upload_from_file(file.file)
        gcs_uri = f"gs://{source_bucket_name}/{file.filename}"
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {e}")

    # Create status record in Firestore
    try:
        invoice_ref = db.collection("invoices").document(file.filename)
        invoice_ref.set({
            "filename": file.filename,
            "status": "UPLOADED",
            "last_modified": datetime.datetime.now(datetime.timezone.utc),
            "gcs_source_uri": gcs_uri
        })
    except Exception as e:
        blob.delete() # Rollback GCS upload if DB write fails
        raise HTTPException(status_code=500, detail=f"Failed to create status record: {e}")

    return {"status": "success", "gcs_uri": gcs_uri, "filename": file.filename}
    
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