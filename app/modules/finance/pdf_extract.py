"""Short-lived PDF text worker. No files, network, JavaScript or attachments are opened."""
import io
import json
import sys

MAX_BYTES = 5_000_000
MAX_PAGES = 15
MAX_CHARS = 60_000
MAX_LINES = 1200


def extract(raw):
    from pypdf import PdfReader
    if not raw.startswith(b'%PDF-') or len(raw) > MAX_BYTES:
        return {'error': 'invalid_pdf'}
    reader = PdfReader(io.BytesIO(raw), strict=True)
    if reader.is_encrypted:
        return {'error': 'pdf_encrypted'}
    if not 1 <= len(reader.pages) <= MAX_PAGES:
        return {'error': 'pdf_too_large'}
    lines, chars = [], 0
    for number, page in enumerate(reader.pages, 1):
        stream = page.get_contents()
        if stream is not None and len(stream.get_data()) > 10_000_000:
            return {'error': 'pdf_too_large'}
        text = page.extract_text(extraction_mode='layout', layout_mode_space_vertically=False) or ''
        values = [line.rstrip() for line in text.splitlines() if line.strip()]
        # Never silently drop an unreadable page from a multi-page statement.
        if not values or '\ufffd' in text or '\x00' in text:
            return {'error': 'pdf_no_text'}
        chars += len(text)
        if chars > MAX_CHARS or len(lines) + len(values) > MAX_LINES:
            return {'error': 'pdf_too_large'}
        lines.extend({'page': number, 'text': value} for value in values)
    return {'lines': lines}


def main():
    # Production Linux: bound even compressed/object-stream bombs in a disposable worker.
    if sys.platform != 'win32':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
        resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    try:
        result = extract(sys.stdin.buffer.read(MAX_BYTES + 1))
    except Exception:
        result = {'error': 'invalid_pdf'}
    sys.stdout.write(json.dumps(result, ensure_ascii=True))


if __name__ == '__main__':
    main()
