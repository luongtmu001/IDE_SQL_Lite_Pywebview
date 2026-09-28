from flask import Blueprint, render_template, jsonify
from app.utils.system_fonts import get_system_fonts

main_bp = Blueprint("main", __name__)

@main_bp.get("/")
def index():
    return render_template("index.html")

@main_bp.get("/api/system/fonts")
def system_fonts():
    try:
        fonts = get_system_fonts()
        return jsonify({"success": True, "data": fonts})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "data": {"all": [], "ui": [], "monospace": []}}), 500
