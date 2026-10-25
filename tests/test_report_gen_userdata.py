# -*- coding: utf-8 -*-
import pytest
from app.services.report_layout_gen.userdata import UserDataGenerator


def test_userdata_generator_uniqueness():
    gen = UserDataGenerator(seed=123)
    generated = set()
    for _ in range(1000):
        uid = gen.new_id()
        assert len(uid) == 8
        assert uid.isalnum()
        assert uid.islower() or any(c.isdigit() for c in uid)
        assert uid not in generated
        generated.add(uid)


def test_userdata_generator_determinism():
    gen1 = UserDataGenerator(seed=999)
    ids1 = [gen1.new_id() for _ in range(5)]

    gen2 = UserDataGenerator(seed=999)
    ids2 = [gen2.new_id() for _ in range(5)]

    assert ids1 == ids2
