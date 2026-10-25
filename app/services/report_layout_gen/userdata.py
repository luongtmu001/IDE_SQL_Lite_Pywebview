# -*- coding: utf-8 -*-
"""
Generator for Bravo merge cell UserData IDs (8-character alphanumeric string).
"""
import random
import string
from typing import Optional, Set


class UserDataGenerator:
    """
    Generates unique 8-character lowercase alphanumeric IDs for merged cells.
    Supports seeding for deterministic golden testing.
    """
    CHARS = string.ascii_lowercase + string.digits

    def __init__(self, seed: Optional[int] = None):
        self._rng = random.Random(seed)
        self._used_ids: Set[str] = set()

    def new_id(self) -> str:
        """Generate a guaranteed unique 8-char ID within this generator's lifecycle."""
        while True:
            candidate = "".join(self._rng.choices(self.CHARS, k=8))
            if candidate not in self._used_ids:
                self._used_ids.add(candidate)
                return candidate

    def reset(self, seed: Optional[int] = None):
        """Reset state and optional seed."""
        self._rng = random.Random(seed)
        self._used_ids.clear()
