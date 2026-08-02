"""Static safety checks for agent-generated presentation renderer code."""

from __future__ import annotations

import ast


BANNED_NAMES = {"eval", "exec", "compile", "__import__", "open", "input"}
BANNED_MODULES = {
    "os", "sys", "subprocess", "socket", "requests", "urllib", "http", "ftplib",
    "pathlib", "shutil", "glob", "importlib", "builtins", "pandas",
}


def validate_renderer_source(source: str) -> None:
    """Minimal safety checks before executing generated Python."""
    tree = ast.parse(source)
    has_render = False
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            _validate_import(node)
        elif isinstance(node, ast.Call):
            _validate_call(node)
        elif isinstance(node, ast.Attribute):
            _validate_attribute(node)
        elif isinstance(node, ast.FunctionDef) and node.name == "render":
            has_render = True
    if not has_render:
        raise ValueError("generated renderer code must define render(ctx)")


def _validate_import(node: ast.Import | ast.ImportFrom) -> None:
    if isinstance(node, ast.Import):
        for alias in node.names:
            root = alias.name.split(".", 1)[0]
            if root in BANNED_MODULES:
                raise ValueError(f"import is not allowed: {alias.name}")
        return
    module = node.module or ""
    root = module.split(".", 1)[0]
    if root in BANNED_MODULES:
        raise ValueError(f"import is not allowed: {module}")
    if module == "openpyxl":
        banned_names = {"load_workbook"}
        for alias in node.names:
            if alias.name in banned_names:
                raise ValueError(f"import is not allowed: {module}.{alias.name}")


def _validate_call(node: ast.Call) -> None:
    if isinstance(node.func, ast.Name) and node.func.id in BANNED_NAMES:
        raise ValueError(f"call is not allowed: {node.func.id}")
    if isinstance(node.func, ast.Attribute) and node.func.attr in BANNED_NAMES:
        raise ValueError(f"call is not allowed: {node.func.attr}")


def _validate_attribute(node: ast.Attribute) -> None:
    if node.attr.startswith("_"):
        raise ValueError(
            "private attributes are not allowed in renderer code; use Deck/Slide public methods only"
        )
    if node.attr == "slide":
        raise ValueError(
            "Deck wrapper internals are not allowed; use Slide.add_title/add_text/add_claim/add_chart/add_table methods"
        )
    if node.attr == "title":
        raise ValueError(
            "object .title attributes are not allowed in renderer code; use Deck.add_title(...) "
            "or slide.shapes.add_textbox(...), and read chart titles with chart['title']"
        )
