from app.config import Settings
from app.services import email


class FakeSMTP:
    instances: list["FakeSMTP"] = []

    def __init__(self, host, port, timeout=None):
        self.host, self.port, self.logged_in, self.sent, self.tls = host, port, None, None, False
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self):
        self.tls = True

    def login(self, user, password):
        self.logged_in = (user, password)

    def send_message(self, msg):
        self.sent = msg


def test_smtp_credentials_are_url_decoded(monkeypatch):
    FakeSMTP.instances.clear()
    monkeypatch.setattr(email.smtplib, "SMTP_SSL", FakeSMTP)
    s = Settings(smtp_url="smtps://me%40gmail.com:pa%24s%20word@smtp.gmail.com:465")
    email.send_email(s, "mom@x.com", "Hi", "Body")
    smtp = FakeSMTP.instances[0]
    assert (smtp.host, smtp.port) == ("smtp.gmail.com", 465)
    assert smtp.logged_in == ("me@gmail.com", "pa$s word")
    assert smtp.sent["From"] == "me@gmail.com" and smtp.sent["To"] == "mom@x.com"


def test_starttls_for_plain_smtp(monkeypatch):
    FakeSMTP.instances.clear()
    monkeypatch.setattr(email.smtplib, "SMTP", FakeSMTP)
    email.send_email(Settings(smtp_url="smtp://u:p@mail.example.com:587"), "a@x.com", "S", "B")
    assert FakeSMTP.instances[0].tls is True
