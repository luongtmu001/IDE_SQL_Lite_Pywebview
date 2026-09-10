from flask import Flask, render_template, request, jsonify
import pyodbc
import sqlparse

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/format', methods=['POST'])
def format_sql():
    """API giả lập tính năng Format của SQL Prompt"""
    data = request.get_json()
    raw_sql = data.get('query', '')
    
    formatted_sql = sqlparse.format(
        raw_sql,
        reindent=True,
        keyword_case='upper',
        identifier_case='lower',
        strip_comments=False
    )
    return jsonify({'formatted_query': formatted_sql})

@app.route('/execute', methods=['POST'])
def execute_query():
    """API thực thi câu lệnh (Hỗ trợ cả SELECT và ALTER/CREATE)"""
    data = request.get_json()
    conn_str = data.get('connection_string', '').strip()
    query = data.get('query', '').strip()

    if not query or not conn_str:
        return jsonify({'error': 'Thiếu chuỗi kết nối hoặc câu lệnh SQL.'}), 400

    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        cursor.execute(query)

        # Kiểm tra xem có phải lệnh trả về dữ liệu (SELECT) không
        if cursor.description:
            columns = [column[0] for column in cursor.description]
            # Đổi giá trị None thành 'NULL' để JSON không bị lỗi
            rows = cursor.fetchall()
            data_rows = [[str(item) if item is not None else "NULL" for item in row] for row in rows]
            
            cursor.close()
            conn.close()
            return jsonify({'type': 'select', 'columns': columns, 'data': data_rows})
        else:
            # Các lệnh thao tác như ALTER, UPDATE, INSERT, DELETE
            conn.commit()
            cursor.close()
            conn.close()
            return jsonify({'type': 'execute', 'message': 'Thực thi lệnh DDL/DML (ALTER, UPDATE...) thành công!'})

    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/databases', methods=['POST'])
def get_databases():
    """API lấy danh sách Databases từ Server"""
    data = request.get_json()
    conn_str = data.get('connection_string', '').strip()
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name")
        dbs = [row[0] for row in cursor.fetchall()]
        cursor.close()
        conn.close()
        return jsonify({'databases': dbs})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/objects', methods=['POST'])
def get_objects():
    """API lấy danh sách Tables, Views, Procedures, Triggers của một Database"""
    data = request.get_json()
    conn_str = data.get('connection_string', '').strip()
    db_name = data.get('database', '').strip()
    
    try:
        conn = pyodbc.connect(conn_str, autocommit=True)
        cursor = conn.cursor()
        
        # Switch DB (Chuyển context sang DB được chọn)
        cursor.execute(f"USE [{db_name}]")
        
        # Get Tables (Chỉ lấy table do người dùng tạo)
        cursor.execute("SELECT name FROM sys.tables WHERE is_ms_shipped = 0 ORDER BY name")
        tables = [row[0] for row in cursor.fetchall()]
        
        # Get Views
        cursor.execute("SELECT name FROM sys.views WHERE is_ms_shipped = 0 ORDER BY name")
        views = [row[0] for row in cursor.fetchall()]
        
        # Get Procedures
        cursor.execute("SELECT name FROM sys.procedures WHERE is_ms_shipped = 0 ORDER BY name")
        procedures = [row[0] for row in cursor.fetchall()]
        
        # Get Triggers
        cursor.execute("SELECT name FROM sys.triggers WHERE is_ms_shipped = 0 ORDER BY name")
        triggers = [row[0] for row in cursor.fetchall()]
        
        cursor.close()
        conn.close()
        return jsonify({
            'tables': tables,
            'views': views,
            'procedures': procedures,
            'triggers': triggers
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(debug=True, port=5000)
