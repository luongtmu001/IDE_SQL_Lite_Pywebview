# -*- coding: utf-8 -*-
"""
Bravo XML Codec and Compression helpers.
Handles beautification, validation, and encoding/decoding of Bravo compressed XML payloads (ZIP Deflate, GZIP, ZLIB, Hex, Base64).
"""
import base64
import gzip
import io
import xml.dom.minidom
import xml.etree.ElementTree as ET
import zipfile
import zlib
from typing import Optional, Tuple, Union


def beautify_xml_string(xml_str: str) -> str:
    """Format an XML string with indentation and standard newlines."""
    if not xml_str or not xml_str.strip():
        return ""
    s = xml_str.strip()
    try:
        dom = xml.dom.minidom.parseString(s)
        pretty = dom.toprettyxml(indent="  ")
        lines = [line for line in pretty.splitlines() if line.strip()]
        return "\n".join(lines)
    except Exception:
        pass

    try:
        wrapped = f"<root>{s}</root>"
        dom = xml.dom.minidom.parseString(wrapped)
        pretty = dom.toprettyxml(indent="  ")
        lines = [line for line in pretty.splitlines() if line.strip()]
        lines = [l for l in lines if not l.startswith("<?xml")]
        if len(lines) >= 2 and lines[0].strip() == "<root>" and lines[-1].strip() == "</root>":
            inner_lines = lines[1:-1]
            outdented = [l[2:] if l.startswith("  ") else l for l in inner_lines]
            return "\n".join(outdented)
    except Exception:
        pass

    try:
        clean = s.replace("><", ">\n<")
        formatted = []
        pad = 0
        for line in clean.split("\n"):
            line = line.strip()
            if not line:
                continue
            if line.startswith("</"):
                if pad > 0:
                    pad -= 1
            indent_str = "  " * pad
            formatted.append(indent_str + line)
            if (
                line.startswith("<")
                and not line.startswith("</")
                and not line.startswith("<?")
                and not line.endswith("/>")
                and "</" not in line
            ):
                pad += 1
        return "\n".join(formatted)
    except Exception:
        return xml_str


def decode_xml_payload(raw_val: Union[str, bytes, None], version: Optional[str] = None) -> str:
    """
    Decompress and decode Bravo XML payload from hex, base64, zip, gzip, zlib, or raw text.
    Returns beautified XML string.
    """
    if not raw_val:
        return ""
    raw_bytes = None
    if isinstance(raw_val, bytes):
        raw_bytes = raw_val
    elif isinstance(raw_val, str):
        str_val = raw_val.strip()
        if str_val.lower().startswith("0x"):
            try:
                raw_bytes = bytes.fromhex(str_val[2:])
            except Exception:
                pass
        elif str_val.lower().startswith("504b0304"):
            try:
                raw_bytes = bytes.fromhex(str_val)
            except Exception:
                pass
        if raw_bytes is None and (str_val.startswith("<") or str_val.startswith("<?xml")):
            return beautify_xml_string(str_val)
        if raw_bytes is None:
            try:
                raw_bytes = base64.b64decode(str_val)
            except Exception:
                raw_bytes = str_val.encode("utf-8", errors="replace")

    if not raw_bytes:
        return ""

    result_text = ""
    if len(raw_bytes) >= 4 and raw_bytes[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as z:
                names = z.namelist()
                if names:
                    result_text = z.read(names[0]).decode("utf-8", errors="replace")
        except Exception:
            pass

    if not result_text and len(raw_bytes) >= 2 and raw_bytes[:2] == b"\x1f\x8b":
        try:
            result_text = gzip.decompress(raw_bytes).decode("utf-8", errors="replace")
        except Exception:
            pass

    if not result_text and len(raw_bytes) >= 2 and raw_bytes[0] == 0x78:
        try:
            result_text = zlib.decompress(raw_bytes).decode("utf-8", errors="replace")
        except Exception:
            pass

    if not result_text:
        try:
            result_text = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            result_text = raw_bytes.decode("utf-16", errors="replace")

        trimmed = result_text.strip()
        if not (trimmed.startswith("<") or trimmed.startswith("<?xml")):
            try:
                b64_bytes = base64.b64decode(trimmed)
                if len(b64_bytes) >= 4 and b64_bytes[:4] == b"PK\x03\x04":
                    with zipfile.ZipFile(io.BytesIO(b64_bytes)) as z:
                        names = z.namelist()
                        if names:
                            result_text = z.read(names[0]).decode("utf-8", errors="replace")
                else:
                    b64_str = b64_bytes.decode("utf-8", errors="replace")
                    if b64_str.strip().startswith("<"):
                        result_text = b64_str
            except Exception:
                pass

    return beautify_xml_string(result_text)


def encode_xml_payload(xml_str: str, version: Optional[str] = None, format_type: str = "zip") -> bytes:
    """
    Encode XML payload to store back into Database.
    Bravo Win & Mobile store LayoutData as a ZIP archive (Deflate)
    containing an internal entry named 'Xml' (b'PK\\x03\\x04...').
    """
    if not xml_str:
        return b""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("Xml", xml_str.encode("utf-8"))
    return buffer.getvalue()


def validate_xml_syntax(xml_str: str) -> Tuple[bool, Optional[str]]:
    """Validate whether an XML string parses without XML syntax errors."""
    if not xml_str or not xml_str.strip():
        return True, None
    try:
        ET.fromstring(xml_str.strip())
        return True, None
    except ET.ParseError as err:
        return False, str(err)


# Aliases for backward compatibility
_beautify_xml_string = beautify_xml_string
_decode_xml_payload = decode_xml_payload
_encode_xml_payload = encode_xml_payload
_validate_xml_syntax = validate_xml_syntax
