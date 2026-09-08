import json
import logging


class SafeFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({'level': record.levelname, 'logger': record.name, 'message': record.getMessage()}, ensure_ascii=False)


def configure_logging():
    handler = logging.StreamHandler()
    handler.setFormatter(SafeFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    # HTTP libraries include query strings and OAuth codes at DEBUG/INFO.
    for name in ('httpx', 'httpcore', 'sqlalchemy.engine'):
        logging.getLogger(name).setLevel(logging.WARNING)
