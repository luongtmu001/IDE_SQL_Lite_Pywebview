from app import create_app

def test_index():
    app = create_app()
    app.config.update(TESTING=True)

    with app.test_client() as client:
        response = client.get("/")

        assert response.status_code == 200
        assert b"SQL IDE" in response.data
