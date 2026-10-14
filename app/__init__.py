# App core package
try:
    from flask import Flask
    from config import Config
    from app.services.connection_manager import ConnectionManager

    def create_app(config_class=Config):
        app = Flask(
            __name__,
            template_folder="../templates",
            static_folder="../static",
            static_url_path="/static",
        )
        app.config.from_object(config_class)
        app.extensions["connection_manager"] = ConnectionManager()

        from app.routes.main import main_bp
        from app.routes.connections import connections_bp
        from app.routes.metadata import metadata_bp
        from app.routes.query import query_bp
        from app.routes.bravo import bravo_bp
        from app.routes.history import history_bp
        from app.routes.postgres_dependency import postgres_dependency_bp
        from app.routes.object_search import object_search_bp
        from app.routes.styles import styles_bp
        from app.routes.session import session_bp

        app.register_blueprint(main_bp)
        app.register_blueprint(connections_bp, url_prefix="/api/connections")
        app.register_blueprint(metadata_bp, url_prefix="/api/metadata")
        app.register_blueprint(query_bp, url_prefix="/api/query")
        app.register_blueprint(bravo_bp, url_prefix="/api/bravo")
        app.register_blueprint(history_bp, url_prefix="/api/history")
        app.register_blueprint(postgres_dependency_bp, url_prefix="/api/postgresql/dependency")
        app.register_blueprint(object_search_bp, url_prefix="/api/sql")
        app.register_blueprint(styles_bp, url_prefix="/api/styles")
        app.register_blueprint(session_bp, url_prefix="/api/session")

        return app
except ImportError:
    # Running in Zero-Network Desktop Native pywebview mode without Flask
    pass
