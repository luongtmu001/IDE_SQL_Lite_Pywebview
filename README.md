# Database IDE - Flask Foundation

Flask foundation for a single-page SQL Server/PostgreSQL database IDE.

## Run

```powershell
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
copy .env.example .env
python run.py
```

Open http://127.0.0.1:5000

## Structure

```text
database_ide/
├── run.py
├── config.py
├── requirements.txt
├── app/
│   ├── routes/
│   ├── database/
│   ├── services/
│   ├── models/
│   └── utils/
├── templates/
├── static/
│   ├── css/
│   └── js/
├── settings/
└── tests/
```

Every query tab has an explicit `connection_id`.
Connections are isolated by owner session and connection ID.

The in-memory ConnectionManager is a foundation/prototype. For production
multi-worker deployment, move live DB connections to a dedicated worker/service
layer instead of assuming Python process memory is shared.
