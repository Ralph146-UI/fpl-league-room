#!/usr/bin/env python3
"""Make a .docx use Aptos as its theme fonts, so Word shows the text as "Aptos (Body)".

    python3 tools/theme_font.py newsletter.docx

docx files name a font in two ways: directly ("Aptos") or through the theme
("Body", which the theme then maps to a font). Word only labels text
"Aptos (Body)" when it goes through the theme, so this rewrites every run to
use the theme's body font and sets the theme's body and heading fonts to Aptos.
"""
import re
import sys
import zipfile
from pathlib import Path

APTOS = '<a:latin typeface="Aptos" panose="020B0004020202020204"/>'
THEME_RUN = '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="minorHAnsi" w:cstheme="minorBidi"/>'


def fix(name, data):
    if name.startswith("word/theme/") and name.endswith(".xml"):
        s = data.decode("utf-8")
        s = re.sub(r"(<a:(?:minor|major)Font>)<a:latin [^>]*/>", lambda m: m.group(1) + APTOS, s)
        return s.encode("utf-8")
    if name in ("word/document.xml", "word/styles.xml", "word/numbering.xml"):
        s = data.decode("utf-8")
        s = re.sub(r'<w:rFonts w:ascii="Aptos"[^>]*/>', THEME_RUN, s)
        return s.encode("utf-8")
    return data


def main(path):
    p = Path(path)
    with zipfile.ZipFile(p) as z:
        items = [(i, z.read(i.filename)) for i in z.infolist()]
    tmp = p.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as out:
        for info, data in items:
            out.writestr(info, fix(info.filename, data))
    tmp.replace(p)


if __name__ == "__main__":
    main(sys.argv[1])
