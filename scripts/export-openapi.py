"""Export the application OpenAPI and all Pydantic response contracts."""
import json
from pathlib import Path
from pydantic.json_schema import models_json_schema
from src.backend import contracts
from src.backend.api import app

root = Path(__file__).resolve().parents[1]
schema = app.openapi()
_, definitions = models_json_schema([(getattr(contracts, name), 'serialization') for name in contracts.CONTRACT_SYNC_MODEL_MAP], ref_template='#/components/schemas/{model}')
schema['components']['schemas'].update(definitions['$defs'])
# Responses are serialized with defaults, including nullable fields. They are present on the wire.
for name in contracts.CONTRACT_SYNC_MODEL_MAP:
    model = schema['components']['schemas'][name]
    model['required'] = list(model.get('properties', {}))
output = root / '.tmp' / 'openapi.json'
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps(schema, indent=2), encoding='utf-8')
manifest = {'version': contracts.API_CONTRACT_VERSION, 'models': contracts.CONTRACT_SYNC_MODEL_MAP}
(root / '.tmp' / 'contract-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
