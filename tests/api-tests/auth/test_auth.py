import pytest


@pytest.mark.later
def test_login():
    pytest.skip("Login test requires a dedicated test credential and request contract")


@pytest.mark.later
def test_register():
    pytest.skip("Registration test must use a controlled test account")


@pytest.mark.later
def test_change_password():
    pytest.skip("Password-change test requires a dedicated test account")


@pytest.mark.later
def test_activate():
    pytest.skip("Activation test requires a controlled test account")


@pytest.mark.later
def test_verify_passphrase():
    pytest.skip("Passphrase test requires controlled credentials")
