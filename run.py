# -*- coding: utf-8 -*-
"""
Runner for pywebview Desktop Native application.
Redirects to main.py
"""
import sys
from pathlib import Path

if getattr(sys, 'frozen', False):
    from importlib.machinery import PathFinder
    if PathFinder in sys.meta_path:
        sys.meta_path.remove(PathFinder)
        sys.meta_path.insert(0, PathFinder)
    meipass = getattr(sys, '_MEIPASS', None)
    if meipass:
        BASE_DIR = Path(meipass).resolve()
    else:
        BASE_DIR = Path(sys.executable).resolve().parent
else:
    BASE_DIR = Path(__file__).resolve().parent

if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from main import main

if __name__ == "__main__":
    main()
