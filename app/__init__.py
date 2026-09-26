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
        return app
except ImportError:
    # Running in Zero-Network Desktop Native pywebview mode without Flask
    pass
