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

        app.register_blueprint(main_bp)
        app.register_blueprint(connections_bp, url_prefix="/api/connections")
        app.register_blueprint(metadata_bp, url_prefix="/api/metadata")
        app.register_blueprint(query_bp, url_prefix="/api/query")
        app.register_blueprint(bravo_bp, url_prefix="/api/bravo")

        return app
except ImportError:
    # Running in Zero-Network Desktop Native pywebview mode without Flask
    pass
