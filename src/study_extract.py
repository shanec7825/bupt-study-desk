"""Extract bounded text from a file received on stdin. Never fetches or writes."""
import io
import json
import re
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET

CAP = 48000
XML_LIMIT = 18 * 1024 * 1024
def paragraphs(blob, namespace, names):
    root = ET.fromstring(blob)
    def content(p):
        return "".join(t.text or "" for t in p.iter(f"{{{namespace}}}t"))
    return "\n".join(content(p) for p in root.iter(f"{{{namespace}}}p"))

def extract(data, ext):
    if ext in ("txt", "md"):
        return data.decode("utf-8-sig")
    if ext == "pdf":
        if b"%PDF-" not in data[:1024]:
            return ""
        s = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", "-", "-"],
                           input=data, capture_output=True, timeout=8, check=True)
        return s.stdout.decode("utf-8")
    if ext not in ("pptx", "docx"):
        return ""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if ext == "docx":
            entries = ["word/document.xml"]
            ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        else:
            pattern = re.compile(r"ppt/slides/slide([1-9][0-9]*)\.xml")
            indexed = [(int(m.group(1)),n) for n in z.namelist() if (m := pattern.fullmatch(n))]
            entries = [name for _,name in sorted(indexed)]
            ns = "http://schemas.openxmlformats.org/drawingml/2006/main"
        if not entries or len(entries) > 300 or sum(z.getinfo(n).file_size for n in entries) > XML_LIMIT:
            return ""
        return "\n\n".join(paragraphs(z.read(n),ns,None) for n in entries)

def main():
    data = sys.stdin.buffer.read(8*1024*1024+1)
    try:
        if len(data)>8*1024*1024: return
        value = extract(data,sys.argv[1]).strip()
        # Extraction indexes visible text, not pictures, embedded objects, speaker notes or OCR.
        print(json.dumps({"text":value[:CAP],"complete":len(value)<=CAP and sys.argv[1] in ("txt","md")},ensure_ascii=False))
    except (IndexError, ValueError, OSError, RuntimeError, KeyError, zipfile.BadZipFile, ET.ParseError, subprocess.SubprocessError):
        print('{"text":"","complete":false}')

if __name__=="__main__":
    main()
