"""X-RevenueCat-Webhook-Signature: `t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`."""

import hashlib
import hmac

import pytest

from app.services.billing import parse_signature, verify_signature

SECRET = "whsec_test"
NOW = 1_800_000_000
BODY = b'{"event":{"id":"e1","type":"TEST"}}'


def sign(body: bytes = BODY, t: int = NOW, secret: str = SECRET) -> str:
    v1 = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={t},v1={v1}"


def test_parse_signature_reads_t_and_v1():
    assert parse_signature("t=123,v1=abcdef") == (123, "abcdef")
    assert parse_signature(" v1=ab , t=5 ") == (5, "ab")  # order and spaces do not matter


@pytest.mark.parametrize("header", [None, "", "garbage", "t=,v1=ab", "t=abc,v1=ab", "t=5",
                                    "t=5,v1=", "v1=ab"])
def test_parse_signature_rejects_malformed_headers(header):
    with pytest.raises(ValueError):
        parse_signature(header)


def test_a_good_signature_verifies():
    assert verify_signature(SECRET, sign(), BODY, NOW)
    assert verify_signature(SECRET, sign().upper().replace("T=", "t=").replace("V1=", "v1="),
                            BODY, NOW)  # hex case is not significant


def test_a_wrong_secret_fails():
    assert not verify_signature(SECRET, sign(secret="other"), BODY, NOW)


def test_a_tampered_body_fails():
    assert not verify_signature(SECRET, sign(), BODY.replace(b"TEST", b"EXPIRATION"), NOW)
    assert not verify_signature(SECRET, sign(), BODY + b" ", NOW)


def test_a_tampered_timestamp_fails():
    # Same v1, a different t: the signed string no longer matches.
    v1 = sign().split("v1=")[1]
    assert not verify_signature(SECRET, f"t={NOW + 1},v1={v1}", BODY, NOW)


def test_the_timestamp_window_is_five_minutes():
    assert verify_signature(SECRET, sign(t=NOW - 300), BODY, NOW)
    assert verify_signature(SECRET, sign(t=NOW + 300), BODY, NOW)
    assert not verify_signature(SECRET, sign(t=NOW - 301), BODY, NOW)  # stale: replay
    assert not verify_signature(SECRET, sign(t=NOW + 301), BODY, NOW)


@pytest.mark.parametrize("header", [None, "", "nonsense", "t=abc,v1=00", "t=1"])
def test_malformed_headers_never_verify(header):
    assert not verify_signature(SECRET, header, BODY, NOW)


def test_non_ascii_signature_value_is_just_wrong():
    assert not verify_signature(SECRET, f"t={NOW},v1=\u00e9\u00e9", BODY, NOW)
