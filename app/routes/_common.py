from uuid import uuid4
from flask import current_app, session

def get_owner_session_id():
    owner_id = session.get("ide_session_id")
    if not owner_id:
        owner_id = f"user_{uuid4().hex}"
        session["ide_session_id"] = owner_id
    return owner_id

def get_connection_manager():
    return current_app.extensions["connection_manager"]
