#!/usr/bin/env python3
"""HEY-188: inspect a print PDF's colour spaces, output intent, page boxes and images.

Usage: python3 scripts/qa/inspect-print-pdf.py file.pdf [expected.icc]

Reads PDFKit's uncompressed object structure (no object streams) with the standard library only. Exits 1 when a
CMYK file (one with an output intent) still uses DeviceRGB, or when the embedded profile differs from expected.icc.
"""
import hashlib
import json
import re
import sys
import zlib

MM = 25.4 / 72


def objects(raw: bytes):
    out = {}
    for m in re.finditer(rb"(\d+) 0 obj\s*(.*?)endobj", raw, re.S):
        body = m.group(2)
        s = body.find(b"stream\n")
        if s >= 0:
            d = body[:s]
            data = body[s + 7 : body.rfind(b"endstream")]
            if b"/FlateDecode" in d:
                try:
                    data = zlib.decompress(data)
                except zlib.error:
                    pass
            out[int(m.group(1))] = (d.decode("latin1"), data)
        else:
            out[int(m.group(1))] = (body.decode("latin1"), None)
    return out


def main() -> int:
    raw = open(sys.argv[1], "rb").read()
    expected = open(sys.argv[2], "rb").read() if len(sys.argv) > 2 else None
    objs = objects(raw)
    report: dict = {"version": raw[:8].decode("latin1").strip(), "colorSpaces": {}, "images": [], "outputIntent": None}
    spaces: dict = {}
    for oid, (d, data) in objs.items():
        text = d
        is_binary = data is not None and re.search(r"/Subtype /Image|/N \d|/Length1|FontFile", d)
        if data is not None and not is_binary:
            text += data.decode("latin1")
        for cs in ("DeviceRGB", "DeviceCMYK", "DeviceGray", "ICCBased", "CalRGB", "Lab"):
            n = len(re.findall(rf"/{cs}\b", text))
            if n:
                spaces[cs] = spaces.get(cs, 0) + n
        if "/Subtype /Image" in d:
            img = {k: (re.search(rf"/{k} (/?\w+)", d) or [None, None])[1] for k in ("Width", "Height", "ColorSpace", "BitsPerComponent")}
            img["softMask"] = bool(re.search(r"/SMask \d+ 0 R", d))
            report["images"].append(img)
        if "/Type /OutputIntent" in d:
            ref = int(re.search(r"/DestOutputProfile (\d+) 0 R", d).group(1))
            pd, icc = objs[ref]
            field = lambda k: (re.search(rf"/{k} \((.*?)\)", d) or [None, None])[1]
            report["outputIntent"] = {
                "S": (re.search(r"/S (/\w+)", d) or [None, None])[1],
                "OutputConditionIdentifier": field("OutputConditionIdentifier"),
                "RegistryName": field("RegistryName"),
                "Info": field("Info"),
                "N": (re.search(r"/N (\d)", pd) or [None, None])[1],
                "iccBytes": len(icc),
                "iccSha256": hashlib.sha256(icc).hexdigest(),
                "iccClass": icc[12:16].decode("latin1"),
                "iccSpace": icc[16:20].decode("latin1"),
                "iccVersion": f"{icc[8]}.{icc[9] >> 4}",
                "matchesExpected": None if expected is None else icc == expected,
            }
    report["colorSpaces"] = spaces
    report["catalogOutputIntents"] = any("/OutputIntents [" in d for d, _ in objs.values() if "/Type /Catalog" in d)
    for box in ("MediaBox", "TrimBox", "BleedBox"):
        m = re.search(rf"/{box} \[([\d. ]+)\]".encode(), raw)
        if m:
            v = [float(x) for x in m.group(1).split()]
            report[box + "Mm"] = [round(x * MM, 2) for x in v]
            report[box + "SizeMm"] = [round((v[2] - v[0]) * MM, 2), round((v[3] - v[1]) * MM, 2)]
    report["vectorPaths"] = sum(
        len(re.findall(rb"\b(?:re|c|l)\n", data)) for d, data in objs.values() if data is not None and "/Subtype" not in d and "/N " not in d
    )
    print(json.dumps(report, indent=2))
    cmyk = report["outputIntent"] is not None
    bad = (cmyk and spaces.get("DeviceRGB", 0) > 0) or (expected is not None and not (report["outputIntent"] or {}).get("matchesExpected"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
