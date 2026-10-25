# -*- coding: utf-8 -*-
"""
Base Abstract Class for Static ResultShape Detectors.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from ..models import ResultShape


class ResultShapeDetector(ABC):
    """Abstract detector for inspecting stored routines statically without execution."""

    def __init__(self, connection_manager: Any, connection_id: str):
        self.connection_manager = connection_manager
        self.connection_id = connection_id

    @abstractmethod
    def list_routines(
        self,
        schema: Optional[str] = None,
        search: Optional[str] = None,
        database: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """List stored procedures / functions available in the database."""
        pass

    @abstractmethod
    def describe_routine(
        self,
        routine_name: str,
        schema: Optional[str] = None,
        database: Optional[str] = None,
    ) -> ResultShape:
        """
        Statically extract ResultShape (result sets, output params, input params)
        without executing the routine.
        """
        pass
