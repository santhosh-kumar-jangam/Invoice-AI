import os
import datetime
from dotenv import load_dotenv
from google.cloud import firestore

# --- SETUP ---
load_dotenv()
try:
    GCP_CREDENTIALS_PATH = os.getenv("gcp_credentials_path")
    db = firestore.Client.from_service_account_json(GCP_CREDENTIALS_PATH)
except Exception as e:
    print(f"FATAL: Could not connect to Firestore. Error: {e}")
    db = None

# --- CORE TOOLS ---

def find_invoices_by_status(status: str) -> list[dict]:
    """
    Finds a list of all invoices that have a given status.
    Valid statuses are 'COMPLETED', 'PROCESSING', 'UPLOADED', 'FAILED'.
    """
    if not db: return [{"error": "Database not connected"}]
    print(f"TOOL: Searching for invoices with status: {status.upper()}")
    invoices = []
    docs = db.collection("invoices").where("status", "==", status.upper()).stream()
    for doc in docs:
        invoices.append(doc.to_dict())
    return invoices

def find_invoices_by_vendor(vendor_name: str) -> list[dict]:
    """
    Finds a list of all invoices from a specific vendor name.
    The search is case-insensitive.
    """
    if not db: return [{"error": "Database not connected"}]
    print(f"TOOL: Searching for vendor: {vendor_name.lower()}")
    invoices = []
    # This query relies on the 'vendor_name_lowercase' promoted field in Firestore.
    docs = db.collection("invoices").where("vendor_name_lowercase", "==", vendor_name.lower()).stream()
    for doc in docs:
        invoices.append(doc.to_dict())
    return invoices

def find_invoice_by_number(invoice_number: str) -> dict:
    """
    Retrieves a single, specific invoice by its unique invoice number.
    The search is case-insensitive.
    """
    if not db: return {"error": "Database not connected"}
    print(f"TOOL: Searching for invoice number: {invoice_number.lower()}")
    # This query relies on the 'invoice_number_lowercase' promoted field in Firestore.
    docs = db.collection("invoices").where("invoice_number_lowercase", "==", invoice_number.lower()).limit(1).stream()
    
    for doc in docs:
        return doc.to_dict() # Return the first and only result
    return {} # Return an empty dictionary if no invoice is found

def count_invoices_by_status(status: str) -> dict:
    """
    Efficiently counts the number of invoices with a given status without retrieving the full data.
    """
    if not db: return {"error": "Database not connected"}
    print(f"TOOL: Counting invoices with status: {status.upper()}")
    query = db.collection("invoices").where("status", "==", status.upper())
    # Use the efficient count() aggregation query
    count_query = query.count()
    result = count_query.get()
    count = result[0][0].value
    return {"status": status.upper(), "count": count}

def get_total_amount_for_completed_invoices() -> dict:
    """
    Calculates the sum of the total_amount for all invoices with 'COMPLETED' status.
    """
    if not db: return {"error": "Database not connected"}
    print("TOOL: Calculating total amount for all completed invoices.")
    total = 0
    currency_set = set()
    # This query relies on the 'total_amount_num' promoted field in Firestore.
    docs = db.collection("invoices").where("status", "==", "COMPLETED").stream()
    for doc in docs:
        data = doc.to_dict()
        total += data.get("total_amount_num", 0)
        if data.get("currency"):
            currency_set.add(data.get("currency"))
    
    if not currency_set:
        return {"total_amount": 0, "currency": "N/A"}

    # A simple way to handle currency. A real app might need more complex logic.
    currency = currency_set.pop() if len(currency_set) == 1 else "MIXED"
    return {"total_amount": total, "currency": currency}

def get_total_amount_for_vendor(vendor_name: str) -> dict:
    """
    Calculates the sum of the total_amount for all invoices from a specific vendor.
    """
    if not db: return {"error": "Database not connected"}
    print(f"TOOL: Calculating total amount for vendor: {vendor_name.lower()}")
    total = 0
    currency_set = set()
    # First, find all invoices for the vendor
    docs = db.collection("invoices").where("vendor_name_lowercase", "==", vendor_name.lower()).stream()
    
    # Then, sum their totals in Python
    invoice_count = 0
    for doc in docs:
        invoice_count += 1
        data = doc.to_dict()
        total += data.get("total_amount_num", 0)
        if data.get("currency"):
            currency_set.add(data.get("currency"))
            
    if invoice_count == 0:
        return {"vendor_name": vendor_name, "total_amount": 0, "currency": "N/A", "invoice_count": 0}

    currency = currency_set.pop() if len(currency_set) == 1 else "MIXED"
    return {"vendor_name": vendor_name, "total_amount": total, "currency": currency, "invoice_count": invoice_count}