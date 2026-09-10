SENSITIVE_KEYS = {
    "password",
    "secret",
    "token",
    "access_token",
    "client_secret",
}

def sanitize_config(config):
    return {
        key: "***" if key.lower() in SENSITIVE_KEYS else value
        for key, value in config.items()
    }
